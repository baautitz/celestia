// @vitest-environment jsdom
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom"
import { useTabParam } from "./use-tab-param"

afterEach(cleanup)

function abrir(url: string, abas: readonly string[]) {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  return renderHook(
    ({ abas }) => {
      const [aba, setAba] = useTabParam(abas)
      return { aba, setAba, search: useLocation().search, navegacao: useNavigationType() }
    },
    { wrapper, initialProps: { abas } },
  )
}

describe("useTabParam", () => {
  it("lê a aba de ?tab=", () => {
    const { result } = abrir("/metas?tab=montar", ["tipos", "montar"])
    expect(result.current.aba).toBe("montar")
  })

  it("sem ?tab= usa a primeira aba e mantém a URL limpa", () => {
    const { result } = abrir("/metas", ["tipos", "montar"])
    expect(result.current.aba).toBe("tipos")
    expect(result.current.search).toBe("")
  })

  it("trocar de aba grava ?tab= sem perder outros parâmetros, e a padrão sai da URL", () => {
    const { result } = abrir("/metas?periodo=3", ["tipos", "montar"])
    act(() => result.current.setAba("montar"))
    expect(result.current.aba).toBe("montar")
    expect(result.current.search).toBe("?periodo=3&tab=montar")
    act(() => result.current.setAba("tipos"))
    expect(result.current.search).toBe("?periodo=3")
  })

  it("aba sem permissão cai na padrão e some da URL", () => {
    const { result } = abrir("/pre-vencidos?tab=conferencia", ["lancamentos"])
    expect(result.current.aba).toBe("lancamentos")
    expect(result.current.search).toBe("")
  })

  it("valor qualquer em ?tab= cai na padrão e some da URL, mantendo os outros parâmetros", () => {
    const { result } = abrir("/metas?periodo=3&tab=xyz", ["tipos", "montar"])
    expect(result.current.aba).toBe("tipos")
    expect(result.current.search).toBe("?periodo=3")
  })

  it("?tab= com a aba padrão some da URL", () => {
    const { result } = abrir("/metas?tab=tipos", ["tipos", "montar"])
    expect(result.current.aba).toBe("tipos")
    expect(result.current.search).toBe("")
  })

  it("trocar de aba substitui a entrada do histórico em vez de empilhar", () => {
    const { result } = abrir("/metas", ["tipos", "montar"])
    act(() => result.current.setAba("montar"))
    expect(result.current.navegacao).toBe("REPLACE")
  })

  it("enquanto as abas carregam não mexe na URL, depois respeita ?tab=", () => {
    const { result, rerender } = abrir("/metas?tab=montar", [])
    expect(result.current.aba).toBeUndefined()
    expect(result.current.search).toBe("?tab=montar")
    rerender({ abas: ["tipos", "montar"] })
    expect(result.current.aba).toBe("montar")
  })
})
