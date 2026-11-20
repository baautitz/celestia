// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIsMobile } from "./use-mobile";

type Listener = () => void;

function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<Listener>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  }));
  return (next: boolean) => {
    matches = next;
    for (const l of listeners) l();
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useIsMobile", () => {
  it("já começa certo no celular, sem passar pelo layout de desktop", () => {
    stubMatchMedia(true);
    const seen: boolean[] = [];
    renderHook(() => {
      const v = useIsMobile();
      seen.push(v);
      return v;
    });
    expect(seen).toEqual([true]);
  });

  it("acompanha a mudança da media query pelo `matches`", () => {
    const change = stubMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => change(true));
    expect(result.current).toBe(true);
  });
});
