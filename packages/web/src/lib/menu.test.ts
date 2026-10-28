import { describe, expect, it } from "vitest";
import type { NavEntry, WebModule } from "@platform/ui/contracts/module";
import { Puzzle } from "lucide-react";
import { buildMenu } from "./menu";

const Screen = () => null;

const entry = (id: string, section: string, order?: number, permission = `p:${id}`): NavEntry => ({
  id,
  label: id,
  icon: Puzzle,
  path: `/${id}`,
  section,
  order,
  permission,
  component: Screen,
});

const mod = (id: string, entries: NavEntry[], sections: WebModule["sections"] = []): WebModule => ({
  id,
  sections,
  entries,
});

const all = () => true;
const shape = (menu: ReturnType<typeof buildMenu>) =>
  menu.map((s) => [s.id, s.entries.map((e) => e.id)] as const);

describe("buildMenu", () => {
  it("orders Sections and entries by order regardless of module registration order", () => {
    const menu = buildMenu(
      [
        mod("b", [entry("b2", "s2", 20), entry("b1", "s2", 10)]),
        mod("a", [entry("a1", "s1", 10)], [
          { id: "s2", label: "S2", order: 200 },
          { id: "s1", label: "S1", order: 100 },
        ]),
      ],
      all,
    );
    expect(shape(menu)).toEqual([
      ["s1", ["a1"]],
      ["s2", ["b1", "b2"]],
    ]);
    expect(menu[0].label).toBe("S1");
  });

  it("breaks order ties by registration order", () => {
    const menu = buildMenu(
      [
        mod("a", [entry("a1", "s", 10)], [{ id: "s", label: "S", order: 100 }]),
        mod("b", [entry("b1", "s", 10)]),
      ],
      all,
    );
    expect(shape(menu)).toEqual([["s", ["a1", "b1"]]]);
  });

  it("breaks Section order ties by registration order", () => {
    const menu = buildMenu(
      [
        mod("a", [entry("a1", "s", 10)], [{ id: "s", label: "S", order: 100 }]),
        mod("b", [entry("b1", "t", 10)], [{ id: "t", label: "T", order: 100 }]),
      ],
      all,
    );
    expect(shape(menu).map(([id]) => id)).toEqual(["s", "t"]);
  });

  it("places entries without order after the ones that declare it, by registration order", () => {
    const menu = buildMenu(
      [mod("a", [entry("x", "s"), entry("y", "s", 10), entry("z", "s")], [{ id: "s", label: "S", order: 100 }])],
      all,
    );
    expect(shape(menu)).toEqual([["s", ["y", "x", "z"]]]);
  });

  it("places Sections without order after the ones that declare it", () => {
    const menu = buildMenu(
      [
        mod("a", [entry("a1", "s1", 10), entry("a2", "s2", 10)], [
          { id: "s1", label: "S1" },
          { id: "s2", label: "S2", order: 100 },
        ]),
      ],
      all,
    );
    expect(shape(menu).map(([id]) => id)).toEqual(["s2", "s1"]);
  });

  it("omits Sections with no accessible entry and keeps order when some entries are hidden", () => {
    const menu = buildMenu(
      [
        mod("a", [entry("a1", "s1", 10), entry("a2", "s1", 20), entry("a3", "s1", 30), entry("b1", "s2", 10)], [
          { id: "s1", label: "S1", order: 100 },
          { id: "s2", label: "S2", order: 200 },
        ]),
      ],
      (p) => p === "p:a1" || p === "p:a3",
    );
    expect(shape(menu)).toEqual([["s1", ["a1", "a3"]]]);
  });

  it("lets a Plugin join a Section declared by another module", () => {
    const menu = buildMenu(
      [
        mod("core", [entry("c1", "reports", 10)], [{ id: "reports", label: "Relatórios", order: 200 }]),
        mod("plugin", [entry("p1", "reports", 20)]),
      ],
      all,
    );
    expect(shape(menu)).toEqual([["reports", ["c1", "p1"]]]);
  });

  it("places a Plugin's new Section at its declared position", () => {
    const menu = buildMenu(
      [
        mod("core", [entry("c1", "a", 10), entry("c2", "c", 10)], [
          { id: "a", label: "A", order: 100 },
          { id: "c", label: "C", order: 300 },
        ]),
        mod("plugin", [entry("p1", "b", 10)], [{ id: "b", label: "B", order: 200 }]),
      ],
      all,
    );
    expect(shape(menu).map(([id]) => id)).toEqual(["a", "b", "c"]);
  });

  it("throws when two modules declare the same Section id", () => {
    expect(() =>
      buildMenu(
        [
          mod("a", [], [{ id: "s", label: "S", order: 100 }]),
          mod("b", [], [{ id: "s", label: "Other", order: 200 }]),
        ],
        all,
      ),
    ).toThrow(/"s"/);
  });

  it("throws when an entry points to an undeclared Section", () => {
    expect(() => buildMenu([mod("a", [entry("a1", "tipo")])], all)).toThrow(/"tipo"/);
  });
});
