// @vitest-environment jsdom
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useLatest } from "./use-latest";

describe("useLatest", () => {
  it("a ref já tem o valor do render atual nos effects do próprio componente", () => {
    const seen: number[] = [];
    function Probe({ value }: { value: number }) {
      const latest = useLatest(value);
      useEffect(() => {
        seen.push(latest.current);
      });
      return null;
    }
    const { rerender } = render(<Probe value={1} />);
    rerender(<Probe value={2} />);
    expect(seen).toEqual([1, 2]);
  });
});
