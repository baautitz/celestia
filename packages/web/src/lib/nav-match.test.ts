import { describe, expect, it } from "vitest";
import { isEntryActive } from "./nav-match";

describe("isEntryActive", () => {
  it("vale para a rota da entrada e suas subrotas", () => {
    expect(isEntryActive("/iam/users", "/iam/users")).toBe(true);
    expect(isEntryActive("/iam/users/42", "/iam/users")).toBe(true);
  });
  it("não vale para outra rota que só começa com o mesmo texto", () => {
    expect(isEntryActive("/iam/users-x", "/iam/users")).toBe(false);
    expect(isEntryActive("/erps", "/iam/users")).toBe(false);
  });
});
