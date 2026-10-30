// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { HeaderActionsProvider, useHeaderActions } from "@/context/HeaderActionsContext";
import { IAMDevicesPage } from "./IAMDevicesPage";

const api = vi.hoisted(() => ({
  iam: { listDevices: vi.fn(), issueDevice: vi.fn(), revokeDevice: vi.fn() },
}));
vi.mock("@/lib/api-client", () => ({ api }));
const permissions = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me", isAdmin: false }, hasPermission: (p: string) => permissions.granted.has(p) }),
}));

const active = { id: "d1", name: "Caixa 1", status: "active", fingerprint: "a".repeat(64), serial: "01", notAfter: "2036-01-01T00:00:00.000Z", createdAt: "2026-10-30T12:00:00.000Z" };
const revoked = { ...active, id: "d2", name: "Celular antigo", status: "revoked", fingerprint: "b".repeat(64), revokedAt: "2026-10-31T12:00:00.000Z" };

beforeEach(() => {
  permissions.granted = new Set(["system:devices:read", "system:devices:create", "system:devices:revoke"]);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  api.iam.listDevices.mockResolvedValue([active, revoked]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Destino das ações do cabeçalho, que no app é o shell. */
const HeaderSlot = () => <>{useHeaderActions().actions}</>;

function renderPage() {
  return render(
    <UiProvider>
      <HeaderActionsProvider>
        <HeaderSlot />
        <IAMDevicesPage />
      </HeaderActionsProvider>
    </UiProvider>,
  );
}

describe("IAMDevicesPage", () => {
  it("lista os Dispositivos com estado e validade, sem mostrar o fingerprint inteiro", async () => {
    renderPage();
    expect(await screen.findByText("Caixa 1")).toBeTruthy();
    expect(screen.getByText("Celular antigo")).toBeTruthy();
    expect(screen.getByText("Ativo")).toBeTruthy();
    expect(screen.getByText("Revogado")).toBeTruthy();
    expect(screen.queryByText("a".repeat(64))).toBeNull();
  });

  it("só oferece revogar o Dispositivo ativo", async () => {
    renderPage();
    await screen.findByText("Caixa 1");
    expect(screen.getAllByRole("button", { name: "Revogar Dispositivo" })).toHaveLength(1);
  });

  it("esconde emitir e revogar de quem só pode visualizar", async () => {
    permissions.granted = new Set(["system:devices:read"]);
    renderPage();
    await screen.findByText("Caixa 1");
    expect(screen.queryByRole("button", { name: "Novo Dispositivo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revogar Dispositivo" })).toBeNull();
  });

  it("emite um Dispositivo e mostra a senha do .pfx para guardar, com o download do certificado", async () => {
    URL.createObjectURL = vi.fn(() => "blob:certificado");
    URL.revokeObjectURL = vi.fn();
    api.iam.issueDevice.mockResolvedValue({ device: { ...active, id: "d3", name: "Caixa 2" }, pfx: "AAEC", password: "SenhaDoPfx-123" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Novo Dispositivo" }));

    fireEvent.change(await screen.findByLabelText("Nome do Dispositivo"), { target: { value: "Caixa 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Emitir certificado" }));

    await waitFor(() => expect(api.iam.issueDevice).toHaveBeenCalledWith({ name: "Caixa 2" }));
    expect(await screen.findByText("SenhaDoPfx-123")).toBeTruthy();
    expect(screen.getByText(/A senha aparece só agora/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Baixar certificado" })).toBeTruthy();
    expect(api.iam.listDevices.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("pede o nome antes de emitir", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Novo Dispositivo" }));
    await screen.findByLabelText("Nome do Dispositivo");
    fireEvent.click(screen.getByRole("button", { name: "Emitir certificado" }));
    expect(await screen.findByText("Informe o nome do Dispositivo.")).toBeTruthy();
    expect(api.iam.issueDevice).not.toHaveBeenCalled();
  });

  it("revoga depois de confirmar, e não revoga se o usuário desistir", async () => {
    api.iam.revokeDevice.mockResolvedValue({ ...active, status: "revoked" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Revogar Dispositivo" }));

    expect(await screen.findByText(/Revogar o certificado do Dispositivo "Caixa 1"\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.iam.revokeDevice).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Revogar Dispositivo" }));
    await screen.findByText(/Revogar o certificado do Dispositivo "Caixa 1"\?/);
    fireEvent.click(screen.getByRole("button", { name: "Revogar" }));
    await waitFor(() => expect(api.iam.revokeDevice).toHaveBeenCalledWith("d1"));
  });

  it("encerra o carregamento sem quebrar quando a API falha", async () => {
    api.iam.listDevices.mockRejectedValue(new Error("Falha de rede"));
    renderPage();
    expect(await screen.findByText("Nenhum Dispositivo encontrado.")).toBeTruthy();
  });
});
