// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Text } from "@platform/ui/components/layout";
import { LoginCertificatePage } from "./LoginCertificatePage";

// Função simples (e não vi.fn): o rastreio de resultados do vi.fn reporta como não tratada a rejeição que a página já trata.
const auth = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const state: { outcome: "ok" | "denied" } = { outcome: "ok" };
  return {
    calls,
    state,
    loginWithCertificate: async (...args: unknown[]) => {
      calls.push(args);
      if (state.outcome === "denied") throw new Error("Dispositivo não autorizado.");
    },
  };
});
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));
const notify = vi.hoisted(() => vi.fn());
vi.mock("@platform/ui/imperative/provider", () => ({ useUi: () => ({ feedback: { notify } }) }));

const DENIED = "Dispositivo não autorizado.";

function open(search: string) {
  render(
    <MemoryRouter initialEntries={[`/login/certificado${search}`]}>
      <Routes>
        <Route path="/login/certificado" element={<LoginCertificatePage />} />
        <Route path="/" element={<Text>página inicial</Text>} />
        <Route path="/login" element={<Text>tela de login</Text>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  notify.mockReset();
  auth.calls.length = 0;
  auth.state.outcome = "ok";
});
afterEach(cleanup);

describe("LoginCertificatePage (callback da autoridade certificadora)", () => {
  it("troca o desafio e o código uma única vez e entra no sistema", async () => {
    open("?challenge=abc&code=xyz");

    expect(await screen.findByText("página inicial")).toBeTruthy();
    expect(auth.calls).toEqual([["abc", "xyz"]]);
  });

  it("sem código (a autoridade não achou um Dispositivo ativo) volta ao login e avisa o motivo", async () => {
    auth.state.outcome = "denied";
    open("?challenge=abc");

    expect(await screen.findByText("tela de login")).toBeTruthy();
    expect(auth.calls).toEqual([["abc", undefined]]);
    expect(notify).toHaveBeenCalledWith({ type: "error", title: DENIED });
  });

  it("sem desafio na URL volta ao login sem chamar o servidor", async () => {
    open("");
    expect(await screen.findByText("tela de login")).toBeTruthy();
    expect(auth.calls).toEqual([]);
    expect(notify).toHaveBeenCalledWith({ type: "error", title: "Falha na autenticação. Entre novamente." });
  });
});
