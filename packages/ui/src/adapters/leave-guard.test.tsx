// @vitest-environment jsdom
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { UiProvider } from "../imperative/provider.tsx"
import { Button } from "../components/button.tsx"
import { confirmLeave, useLeaveGuard } from "./leave-guard.ts"

afterEach(cleanup)

function Tela({ nome }: { nome: string }) {
  const [pending, setPending] = useState(true)
  useLeaveGuard(pending)
  return <Button onClick={() => setPending((p) => !p)}>{`alternar ${nome}`}</Button>
}

function montar(telas: string[]) {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <UiProvider>
          {telas.map((nome) => (
            <Tela key={nome} nome={nome} />
          ))}
        </UiProvider>
      ),
    },
    { path: "/outra", element: <p>outra tela</p> },
  ])
  render(<RouterProvider router={router} />)
  return router
}

describe("useLeaveGuard", () => {
  it("duas telas guardadas ao mesmo tempo perguntam uma vez só e descartar vale para as duas", async () => {
    montar(["a", "b"])

    let resposta!: Promise<boolean>
    act(() => {
      resposta = confirmLeave()
    })
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }))

    expect(await resposta).toBe(true)
    expect(screen.queryByRole("button", { name: "Descartar" })).toBeNull()
  })

  it("sem tela com alterações pendentes, sair não pergunta", async () => {
    montar(["a"])
    fireEvent.click(screen.getByRole("button", { name: "alternar a" }))
    await expect(confirmLeave()).resolves.toBe(true)
  })

  it("depois de descartar, voltar a ter alterações pendentes pergunta de novo ao navegar", async () => {
    const router = montar(["a"])

    let resposta!: Promise<boolean>
    act(() => {
      resposta = confirmLeave()
    })
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }))
    await resposta

    // Salva e edita de novo: a tela arma o guarda outra vez.
    fireEvent.click(screen.getByRole("button", { name: "alternar a" }))
    fireEvent.click(screen.getByRole("button", { name: "alternar a" }))

    act(() => {
      void router.navigate("/outra")
    })
    expect(await screen.findByRole("button", { name: "Descartar" })).toBeTruthy()
    expect(screen.queryByText("outra tela")).toBeNull()
  })
})
