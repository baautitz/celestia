import { describe, expect, it, vi } from "vitest"
import type { DiscardRequest, FocusTarget } from "../contracts/windows.ts"
import { WindowController } from "./controller.ts"

const flush = () => new Promise<void>((r) => setImmediate(r))

function setup(discard = false) {
  const focus = vi.fn()
  const restoreFocus = vi.fn((t: FocusTarget | null) => t?.focus())
  const releases: Array<() => void> = []
  const confirmDiscard = vi.fn(
    (_: DiscardRequest) => new Promise<boolean>((resolve) => releases.push(() => resolve(discard))),
  )
  const c = new WindowController({ confirmDiscard, restoreFocus })
  return { c, focus, restoreFocus, confirmDiscard, releases }
}

describe("WindowController", () => {
  it("só a janela do topo resolve; promise liquida uma vez", async () => {
    const { c } = setup()
    const first = c.open({})
    const firstId = c.snapshot().activeId!
    const second = c.open({})
    const secondId = c.snapshot().activeId!
    expect(secondId).not.toBe(firstId)

    c.resolve(firstId, "x")
    expect(c.snapshot().activeId).toBe(secondId)

    c.dismiss(secondId)
    expect(await second).toEqual({ status: "cancelled", reason: "cancel" })
    c.resolve(secondId, "late")
    expect(c.snapshot().activeId).toBe(firstId)

    c.resolve(firstId, 42)
    expect(await first).toEqual({ status: "confirmed", value: 42 })
    c.dismiss(firstId)
    expect(c.snapshot().windows).toEqual([])
  })

  it("dirty check é lazy, não republica e bloqueia fechamento duplicado", async () => {
    const { c, focus, confirmDiscard, releases } = setup()
    c.open({}, { focus })
    const id = c.snapshot().activeId!
    const listener = vi.fn()
    c.subscribe(listener)
    const dirty = vi.fn(() => true)
    c.setDirtyCheck(id, dirty)
    expect(listener).not.toHaveBeenCalled()
    expect(dirty).not.toHaveBeenCalled()

    c.requestDismiss(id, "escape")
    c.requestDismiss(id, "escape")
    expect(confirmDiscard).toHaveBeenCalledTimes(1)
    expect(dirty).toHaveBeenCalledTimes(1)
    expect(confirmDiscard).toHaveBeenCalledWith({ windowId: id, reason: "escape" })

    releases[0]()
    await flush()
    expect(c.snapshot().activeId).toBe(id)
    expect(focus).not.toHaveBeenCalled()
  })

  it("descartar confirmado fecha com 'discarded' e restaura foco", async () => {
    const { c, focus, releases } = setup(true)
    const p = c.open({}, { focus })
    const id = c.snapshot().activeId!
    c.setDirtyCheck(id, () => true)
    c.requestDismiss(id, "cancel")
    releases[0]()
    await flush()
    expect(await p).toEqual({ status: "cancelled", reason: "discarded" })
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it("sem dirty check fecha direto", async () => {
    const { c, confirmDiscard } = setup()
    const p = c.open({})
    c.requestDismiss(c.snapshot().activeId!, "outside")
    expect(await p).toEqual({ status: "cancelled", reason: "outside" })
    expect(confirmDiscard).not.toHaveBeenCalled()
  })

  it("dismissAll e dispose resolvem como unmounted", async () => {
    const { c, restoreFocus } = setup()
    const a = c.open({})
    const b = c.open({})
    c.dismissAll()
    expect(await a).toEqual({ status: "cancelled", reason: "unmounted" })
    expect(await b).toEqual({ status: "cancelled", reason: "unmounted" })
    expect(restoreFocus).not.toHaveBeenCalled()

    const d = c.open({})
    c.dispose()
    expect(await d).toEqual({ status: "cancelled", reason: "unmounted" })
    expect(await c.open({})).toEqual({ status: "cancelled", reason: "unmounted" })
  })
})
