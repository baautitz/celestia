// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChartContainer, type ChartConfig } from "./chart";

afterEach(cleanup);

const styleOf = (config: ChartConfig, id?: string) => {
  const { container } = render(
    <ChartContainer config={config} id={id}>
      <svg />
    </ChartContainer>,
  );
  return container.querySelector("style")?.textContent ?? "";
};

describe("ChartContainer estilos", () => {
  it("emite cores em formatos conhecidos", () => {
    const css = styleOf({
      a: { color: "#1a2b3c" },
      b: { color: "hsl(210 40% 50%)" },
      c: { color: "var(--chart-1)" },
      d: { theme: { light: "rgb(1, 2, 3)", dark: "oklch(0.7 0.1 200)" } },
    });
    expect(css).toContain("--color-a: #1a2b3c;");
    expect(css).toContain("--color-b: hsl(210 40% 50%);");
    expect(css).toContain("--color-c: var(--chart-1);");
    expect(css).toContain("--color-d: rgb(1, 2, 3);");
    expect(css).toContain("--color-d: oklch(0.7 0.1 200);");
  });

  it("descarta cor ou chave que escapariam da declaração CSS", () => {
    const css = styleOf({
      ok: { color: "#fff" },
      evil: { color: "red;} </style><script>alert(1)</script>" },
      "bad key}": { color: "#000" },
    });
    expect(css).toContain("--color-ok: #fff;");
    expect(css).not.toContain("evil");
    expect(css).not.toContain("script");
    expect(css).not.toContain("bad key");
  });

  it("não emite estilo quando o id é inseguro", () => {
    expect(styleOf({ a: { color: "#fff" } }, "x] { } </style>")).toBe("");
  });
});
