import { describe, expect, it } from "vitest";
import type { NavEntry } from "@platform/ui/contracts/module";
import { Puzzle } from "lucide-react";
import { canSeeEntry, resolveEntryScreen } from "./entry-screen";

const Default = () => null;
const A = () => null;
const B = () => null;

const entry: NavEntry = {
  id: "x",
  label: "X",
  icon: Puzzle,
  path: "/x",
  section: "s",
  permission: "p:base",
  component: Default,
  variants: [
    { permission: "p:a", component: A },
    { permission: "p:b", component: B },
  ],
};

const has = (granted: string[]) => (p: string) => granted.includes("*") || granted.includes(p);

describe("resolveEntryScreen", () => {
  it("picks the first variant by declaration order", () => {
    expect(resolveEntryScreen(entry, has(["p:b", "p:a"]))).toBe(A);
  });
  it("falls back to default screen when no variant matches", () => {
    expect(resolveEntryScreen(entry, has(["p:base"]))).toBe(Default);
  });
  it("denies when nothing matches", () => {
    expect(resolveEntryScreen(entry, has(["other"]))).toBeNull();
  });
  it("denies an empty permission list", () => {
    expect(resolveEntryScreen(entry, has([]))).toBeNull();
    expect(canSeeEntry(entry, has([]))).toBe(false);
  });
  it("shows entry when only a variant permission is held", () => {
    expect(canSeeEntry(entry, has(["p:b"]))).toBe(true);
    expect(resolveEntryScreen(entry, has(["p:b"]))).toBe(B);
  });
  it("wildcard sees everything, first variant wins", () => {
    expect(canSeeEntry(entry, has(["*"]))).toBe(true);
    expect(resolveEntryScreen(entry, has(["*"]))).toBe(A);
  });
  it("entry without variants uses default", () => {
    const plain: NavEntry = { ...entry, variants: undefined };
    expect(resolveEntryScreen(plain, has(["p:base"]))).toBe(Default);
  });
});
