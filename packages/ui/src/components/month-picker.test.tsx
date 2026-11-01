// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MonthPicker } from "./month-picker";

afterEach(cleanup);

function Harness({ initial, seen }: { initial?: string; seen: Array<string | undefined> }) {
  const [value, setValue] = React.useState<string | undefined>(initial);
  return (
    <MonthPicker
      value={value}
      onChange={(v) => {
        seen.push(v);
        setValue(v);
      }}
    />
  );
}

describe("MonthPicker", () => {
  it("aplica a máscara mm/aaaa e devolve AAAA-MM quando o texto está completo", async () => {
    const seen: Array<string | undefined> = [];
    render(<Harness seen={seen} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await userEvent.type(input, "062027");
    expect(input.value).toBe("06/2027");
    expect(seen.at(-1)).toBe("2027-06");
  });

  it("mostra o valor recebido como mm/aaaa", () => {
    render(<Harness initial="2027-06" seen={[]} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("06/2027");
  });

  it("mês inexistente mostra a mensagem e limpa o valor anterior", async () => {
    const seen: Array<string | undefined> = [];
    render(<Harness initial="2027-06" seen={seen} />);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "132027");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Mês inválido");
    expect(seen.at(-1)).toBeUndefined();
  });

  it("escolhe o mês no seletor e navega entre os anos", async () => {
    const seen: Array<string | undefined> = [];
    render(<Harness initial="2027-06" seen={seen} />);
    await userEvent.click(screen.getByRole("button", { name: "Escolher mês" }));
    await userEvent.click(screen.getByRole("button", { name: "Próximo ano" }));
    await userEvent.click(screen.getByRole("button", { name: "mar" }));
    expect(seen.at(-1)).toBe("2028-03");
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("03/2028");
  });
});
