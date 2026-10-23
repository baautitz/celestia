// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DateRange } from "react-day-picker";
import { DatePicker } from "./date-picker";
import { DateRangePicker } from "./date-range-picker";

afterEach(cleanup);

function SingleHarness({ initial, seen }: { initial?: Date; seen: Array<Date | undefined> }) {
  const [value, setValue] = React.useState<Date | undefined>(initial);
  return (
    <DatePicker
      value={value}
      onChange={(d) => {
        seen.push(d);
        setValue(d);
      }}
    />
  );
}

function RangeHarness({ initial, seen }: { initial?: DateRange; seen: Array<DateRange | undefined> }) {
  const [value, setValue] = React.useState<DateRange | undefined>(initial);
  return (
    <DateRangePicker
      value={value}
      onChange={(r) => {
        seen.push(r);
        setValue(r);
      }}
    />
  );
}

describe("DatePicker: texto inválido", () => {
  it("mostra a mensagem e limpa o valor anterior em vez de mantê-lo", async () => {
    const seen: Array<Date | undefined> = [];
    render(<SingleHarness initial={new Date(2026, 2, 15)} seen={seen} />);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "31022026");
    expect((input as HTMLInputElement).value).toBe("31/02/2026");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Data inválida");
    expect(seen.at(-1)).toBeUndefined();
  });

  it("corrigir o texto remove a mensagem e emite a nova data", async () => {
    const seen: Array<Date | undefined> = [];
    render(<SingleHarness initial={new Date(2026, 2, 15)} seen={seen} />);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "31022026");
    await userEvent.clear(input);
    await userEvent.type(input, "28022026");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(seen.at(-1)?.getDate()).toBe(28);
  });

  it("não mostra erro para texto vazio nem para o valor inicial", () => {
    render(<SingleHarness initial={new Date(2026, 2, 15)} seen={[]} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("DateRangePicker: texto inválido", () => {
  it("mostra a mensagem e limpa o período anterior", async () => {
    const seen: Array<DateRange | undefined> = [];
    render(<RangeHarness initial={{ from: new Date(2026, 0, 1), to: new Date(2026, 0, 31) }} seen={seen} />);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "3101202601012026");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Período inválido");
    expect(seen.at(-1)).toBeUndefined();
  });
});
