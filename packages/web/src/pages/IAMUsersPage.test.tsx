// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { HeaderActionsProvider } from "@/context/HeaderActionsContext";
import { IAMUsersPage } from "./IAMUsersPage";

const api = vi.hoisted(() => ({
  iam: { listUsers: vi.fn(), listRoles: vi.fn(), updateUser: vi.fn() },
}));
vi.mock("@/lib/api-client", () => ({ api }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "me", isAdmin: true },
    hasPermission: () => true,
  }),
}));

const user = { id: "u1", fullname: "Maria Souza", username: "maria", email: "m@x.com", roleId: "gestor", status: "active", isAdmin: false };

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  api.iam.listUsers.mockResolvedValue([user]);
  api.iam.listRoles.mockResolvedValue([{ id: "gestor", name: "Gestor", permissions: [] }]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <UiProvider>
      <HeaderActionsProvider>
        <IAMUsersPage />
      </HeaderActionsProvider>
    </UiProvider>,
  );
}

describe("IAMUsersPage", () => {
  it("carrega usuários e perfis uma única vez ao montar", async () => {
    renderPage();
    expect(await screen.findByText("Maria Souza")).toBeTruthy();
    expect(api.iam.listUsers).toHaveBeenCalledTimes(1);
    expect(api.iam.listRoles).toHaveBeenCalledTimes(1);
  });

  it("o administrador liga o acesso sem certificado na edição", async () => {
    api.iam.updateUser.mockResolvedValue(user);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Editar Usuário" }));
    const toggle = await screen.findByRole("switch", { name: "Permitir acesso sem certificado" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Salvar Alterações" }));
    await waitFor(() => expect(api.iam.updateUser).toHaveBeenCalledWith("u1", expect.objectContaining({ allowWithoutCertificate: true })));
  });

  it("mostra quem acessa sem certificado na lista", async () => {
    api.iam.listUsers.mockResolvedValue([{ ...user, allowWithoutCertificate: true }, { ...user, id: "u2", fullname: "Outro Nome", username: "outro" }]);
    renderPage();
    await screen.findByText("Maria Souza");
    expect(screen.getAllByText("Sem certificado")).toHaveLength(1);
    expect(screen.getAllByText("Com certificado")).toHaveLength(1);
  });

  it("encerra o carregamento sem quebrar quando a API falha", async () => {
    api.iam.listUsers.mockRejectedValue(new Error("Falha de rede"));
    renderPage();
    expect(await screen.findByText("Nenhum usuário encontrado.")).toBeTruthy();
  });
});
