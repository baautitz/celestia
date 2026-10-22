import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Table, TableHeader } from "./table";

describe("Table", () => {
  it("keeps the header sticky inside a height-bounded scroll container", () => {
    const html = renderToStaticMarkup(
      createElement(Table, null, createElement(TableHeader)),
    );
    expect(html).toMatch(/data-slot="table-container"[^>]*class="[^"]*max-h-svh/);
    expect(html).toMatch(/data-slot="table-header"[^>]*class="[^"]*sticky top-0/);
  });
});
