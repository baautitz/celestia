// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PasswordInput } from "./password-input"

afterEach(cleanup)

describe("PasswordInput", () => {
  it("o olho mostra e esconde a senha", () => {
    render(<PasswordInput aria-label="Senha" defaultValue="Segredo@1" />)
    const campo = screen.getByLabelText("Senha") as HTMLInputElement
    expect(campo.type).toBe("password")
    fireEvent.click(screen.getByRole("button", { name: "Mostrar senha" }))
    expect(campo.type).toBe("text")
    fireEvent.click(screen.getByRole("button", { name: "Esconder senha" }))
    expect(campo.type).toBe("password")
  })
})
