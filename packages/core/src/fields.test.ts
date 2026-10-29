import { describe, it, expectTypeOf } from "vitest";
import type { FormFieldDef } from "./index.js";

describe("FormFieldDef", () => {
  it("is exported by the core barrel", () => {
    expectTypeOf<{ name: string; label: string; type: "password" }>().toMatchTypeOf<FormFieldDef>();
  });
});
