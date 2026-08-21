import { describe, it, expect } from "vitest";
import { TemplateEngine } from "../src/engine/template-engine.js";

describe("TemplateEngine (Segurança & Bind Parameters)", () => {
  it("deve converter tokens em parâmetros posicionais seguros (@p1, @p2)", () => {
    const rawSql = `
      SELECT id, name FROM vendas 
      WHERE created_at BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}
        AND vendedor_id = {{user.externals.inovafarma}}
    `;

    const context = {
      workspace: {
        start_date: "2026-01-01",
        end_date: "2026-01-31",
      },
      user: {
        externals: {
          inovafarma: 42,
        },
      },
    };

    const result = TemplateEngine.parse(rawSql, context);

    expect(result.sql).toContain("@p1");
    expect(result.sql).toContain("@p2");
    expect(result.sql).toContain("@p3");
    expect(result.params).toEqual({
      p1: "2026-01-01",
      p2: "2026-01-31",
      p3: 42,
    });
  });

  it("deve tratar tokens não encontrados como null com segurança", () => {
    const rawSql = "SELECT * FROM produtos WHERE cat_id = {{workspace.categories_focus}}";
    const context = { workspace: {} };

    const result = TemplateEngine.parse(rawSql, context);

    expect(result.sql).toContain("@p1");
    expect(result.params.p1).toBeNull();
  });
});
