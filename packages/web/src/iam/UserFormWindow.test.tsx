// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider, useUi } from "@platform/ui/imperative/provider";
import { Button } from "@platform/ui/components/button";
import { usersWebService } from "./UserFormWindow";

const api = vi.hoisted(() => ({ iam: { listRoles: vi.fn(), createUser: vi.fn() } }));
vi.mock("@/lib/api-client", () => ({ api }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { sub: "me", isAdmin: false } }) }));

const criado = { id: "u9", fullname: "ANA SOUZA", username: "ana_souza" };
let resultado: unknown;

function Abrir() {
  const { windows } = useUi();
  const sugerir = (nome: string) => nome.toLowerCase().split(" ").join("_");
  return <Button onClick={() => void usersWebService.openCreate(windows, { fullname: "ANA SOUZA", suggestUsername: sugerir }).then((u) => (resultado = u))}>Abrir</Button>;
}

beforeEach(() => {
  resultado = undefined;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  api.iam.listRoles.mockResolvedValue([{ id: "gestor", name: "Gestor", permissions: [] }]);
  api.iam.createUser.mockResolvedValue(criado);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("serviço iam:users", () => {
  it("abre o cadastro de Usuário com o nome e o username sugerido, sem e-mail, e devolve o Usuário criado", async () => {
    render(
      <UiProvider>
        <Abrir />
      </UiProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(((await screen.findByLabelText("Nome de Usuário")) as HTMLInputElement).value).toBe("ana_souza");
    expect((screen.getByLabelText("Nome Completo") as HTMLInputElement).value).toBe("ANA SOUZA");
    fireEvent.change(screen.getByLabelText("Senha Inicial"), { target: { value: "Senha@123" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar Usuário" }));
    await waitFor(() => expect(resultado).toEqual(criado));
    expect(api.iam.createUser).toHaveBeenCalledWith(expect.objectContaining({ fullname: "ANA SOUZA", username: "ana_souza", email: undefined, password: "Senha@123", roleId: "gestor" }));
  });
});
