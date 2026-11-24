// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Checkbox } from "./checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("mostra o estado parcial com aria-checked mixed e o traço no lugar do check", () => {
    render(<Checkbox aria-label="todos" checked={false} indeterminate />);
    const caixa = screen.getByRole("checkbox", { name: "todos" });
    expect(caixa.getAttribute("aria-checked")).toBe("mixed");
    expect(caixa.hasAttribute("data-indeterminate")).toBe(true);
    expect(caixa.querySelector("svg.lucide-minus")).not.toBeNull();
  });
});
