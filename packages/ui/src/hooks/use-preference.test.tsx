// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ApiError, setApiFetch, type ApiFetch } from "../lib/api";
import { feedbackService } from "../adapters/feedback-toast";
import { usePreference } from "./use-preference";

const stored: Record<string, unknown> = { a: "tabela", b: "cartoes" };
const fetchMock = vi.fn<(path: string, options?: RequestInit) => Promise<unknown>>();
/** `ApiFetch` é genérico no tipo da resposta; o mock devolve `unknown` e o teste escolhe o que devolver. */
const apiFetchMock: ApiFetch = <T,>(path: string, options?: RequestInit) => fetchMock(path, options) as Promise<T>;

afterEach(() => {
  fetchMock.mockReset();
  vi.restoreAllMocks();
});

const readStored = async (path: string) => {
  const key = decodeURIComponent(path.split("/").pop() ?? "");
  return { value: stored[key] ?? null };
};

describe("usePreference", () => {
  it("volta ao padrão ao trocar a chave, até a leitura da nova chegar", async () => {
    fetchMock.mockImplementation(async (path, options) => options?.method === "PUT" ? undefined : readStored(path));
    setApiFetch(apiFetchMock);
    const { result, rerender } = renderHook(({ k }) => usePreference(k, "padrao"), { initialProps: { k: "a" } });
    await waitFor(() => expect(result.current[0]).toBe("tabela"));

    rerender({ k: "c" });
    expect(result.current[0]).toBe("padrao");

    rerender({ k: "b" });
    await waitFor(() => expect(result.current[0]).toBe("cartoes"));
  });

  it("avisa o usuário quando salvar falha", async () => {
    const notifyError = vi.spyOn(feedbackService, "notifyError").mockImplementation(() => undefined);
    fetchMock.mockImplementation(async (_path, options) => {
      if (options?.method === "PUT") throw new ApiError("Sem permissão", 403);
      return { value: null };
    });
    setApiFetch(apiFetchMock);
    const { result } = renderHook(() => usePreference("a", "padrao"));

    act(() => result.current[1]("cartoes"));

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith(expect.objectContaining({ message: "Sem permissão" }), expect.any(String)));
    expect(result.current[0]).toBe("cartoes");
  });
});
