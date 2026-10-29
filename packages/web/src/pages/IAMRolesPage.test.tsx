// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UiProvider } from "@platform/ui/imperative/provider";
import { HeaderActionsProvider } from "@/context/HeaderActionsContext";
import { IAMRolesPage } from "./IAMRolesPage";

const api = vi.hoisted(() => ({
  iam: { listRoles: vi.fn(), getCatalog: vi.fn() },
}));
vi.mock("@/lib/api-client", () => ({ api }));
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me" }, hasPermission: () => true }),
}));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  api.iam.listRoles.mockResolvedValue([{ id: "gestor", name: "Gestor", description: "", permissions: ["a:b:c"] }]);
  api.iam.getCatalog.mockResolvedValue({ modules: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <UiProvider>
      <HeaderActionsProvider>
        <IAMRolesPage />
      </HeaderActionsProvider>
    </UiProvider>,
  );
}

describe("IAMRolesPage", () => {
  it("carrega grupos e catálogo uma única vez ao montar", async () => {
    renderPage();
    expect(await screen.findByText("Gestor")).toBeTruthy();
    expect(api.iam.listRoles).toHaveBeenCalledTimes(1);
    expect(api.iam.getCatalog).toHaveBeenCalledTimes(1);
  });

  it("encerra o carregamento sem quebrar quando a API falha", async () => {
    api.iam.listRoles.mockRejectedValue(new Error("Falha de rede"));
    renderPage();
    expect(await screen.findByText("Nenhum grupo de acesso cadastrado.")).toBeTruthy();
  });
});
