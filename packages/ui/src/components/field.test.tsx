// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FieldError } from "./field";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FieldError", () => {
  it("lista cada mensagem distinta uma vez, sem alerta de chave do React", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<FieldError errors={[{ message: "Obrigatório" }, { message: "Muito curto" }, { message: "Obrigatório" }]} />);

    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Obrigatório", "Muito curto"]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("mostra uma mensagem única como texto", () => {
    render(<FieldError errors={[{ message: "Obrigatório" }]} />);
    expect(screen.getByRole("alert").textContent).toBe("Obrigatório");
  });
});
