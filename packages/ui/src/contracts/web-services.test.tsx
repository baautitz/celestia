// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { buildWebServices, useWebService, WebServicesProvider } from "./web-services"

afterEach(cleanup)

const Pagina = () => <>{useWebService<{ nome: string }>("iam", "users").nome}</>

describe("serviços entre módulos web", () => {
  it("um módulo chama o serviço de quem ele depende", () => {
    const services = buildWebServices([
      { id: "iam", entries: [], services: { users: { nome: "cadastro de Usuário" } } },
      { id: "plugin", entries: [], dependsOn: ["iam"] },
    ])
    render(
      <WebServicesProvider services={services}>
        <Pagina />
      </WebServicesProvider>,
    )
    expect(screen.getByText("cadastro de Usuário")).toBeTruthy()
  })

  it("lança se a dependência não está registrada antes", () => {
    expect(() => buildWebServices([{ id: "plugin", entries: [], dependsOn: ["iam"] }, { id: "iam", entries: [] }])).toThrow(/depende de "iam"/)
  })
})
