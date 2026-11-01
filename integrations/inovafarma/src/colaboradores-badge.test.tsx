// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { ColaboradoresPendentesBadge, avisarVinculoAlterado } from "./colaboradores-badge";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/lib/api", async (original) => ({ ...(await original<typeof import("@platform/ui/lib/api")>()), apiFetch }));

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

describe("ColaboradoresPendentesBadge", () => {
  it("mostra o total e atualiza quando um vínculo muda", async () => {
    apiFetch.mockResolvedValueOnce({ total: 3 }).mockResolvedValueOnce({ total: 2 });
    render(<ColaboradoresPendentesBadge />);
    expect((await screen.findByLabelText("3 Colaboradores pendentes")).textContent).toBe("3");
    act(() => avisarVinculoAlterado());
    expect((await screen.findByLabelText("2 Colaboradores pendentes")).textContent).toBe("2");
  });

  it("não mostra nada sem pendentes ou com o ERP indisponível", async () => {
    apiFetch.mockRejectedValueOnce(new Error("ERP indisponível"));
    const { container } = render(<ColaboradoresPendentesBadge />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
