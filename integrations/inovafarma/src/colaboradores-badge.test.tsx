// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@platform/ui/lib/api";
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

  it("esconde o badge quando o ERP deixa de responder", async () => {
    apiFetch.mockResolvedValueOnce({ total: 3 }).mockRejectedValueOnce(new Error("ERP indisponível"));
    render(<ColaboradoresPendentesBadge />);
    expect(await screen.findByLabelText("3 Colaboradores pendentes")).toBeDefined();
    act(() => avisarVinculoAlterado());
    await waitFor(() => expect(screen.queryByLabelText("3 Colaboradores pendentes")).toBeNull());
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("não consulta de novo depois que o servidor nega a Permission", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError("Sem permissão", 403));
    render(<ColaboradoresPendentesBadge />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    await act(async () => avisarVinculoAlterado());
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
