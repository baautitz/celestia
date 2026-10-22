// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { Form } from "../components/form";
import { DynamicFormFields } from "./DynamicFormFields";
import { buildDynamicDefaultValues, type DynamicFormValues } from "./dynamic-form";
import type { FormFieldDef } from "@platform/shared";

afterEach(cleanup);

const lookup = { source: "erp", query: "select 1" };
const fetchLookupOptions = async () => [{ value: "1", label: "Um" }];

function Harness({ fields }: { fields: FormFieldDef[] }) {
  const form = useForm<DynamicFormValues>({ defaultValues: buildDynamicDefaultValues(fields) });
  return (
    <Form {...form}>
      <DynamicFormFields fields={fields} form={form} fetchLookupOptions={fetchLookupOptions} />
    </Form>
  );
}

const allTypes: FormFieldDef[] = [
  { name: "t", label: "Texto", type: "text" },
  { name: "ta", label: "Area", type: "textarea" },
  { name: "pw", label: "Senha", type: "password" },
  { name: "sw", label: "Chave", type: "switch" },
  { name: "mo", label: "Valor", type: "money" },
  { name: "nu", label: "Numero", type: "number" },
  { name: "se", label: "Escolha", type: "select", options: ["a", "b"] },
  { name: "ls", label: "Busca", type: "lookup_select", lookup },
  { name: "ms", label: "Varios", type: "multi_select", lookup },
  { name: "da", label: "Data", type: "date" },
];

describe("DynamicFormFields", () => {
  it("renders every field type unchanged", async () => {
    const { container } = render(<Harness fields={allTypes} />);
    await waitFor(() => expect(container.querySelector("[data-slot=skeleton]")).toBeNull());
    expect(container.innerHTML.replace(/(id|for|aria-[a-z]+)="[^"]*"/g, "$1")).toMatchSnapshot();
  });

  it("survives changing the field list and field type", async () => {
    const { rerender, container } = render(<Harness fields={[allTypes[0]]} />);
    rerender(<Harness fields={allTypes} />);
    rerender(<Harness fields={[allTypes[8]]} />);
    rerender(<Harness fields={[{ name: "ms", label: "Varios", type: "textarea" }]} />);
    rerender(<Harness fields={[allTypes[7], allTypes[0]]} />);
    await waitFor(() => expect(container.textContent).toContain("Texto"));
  });
});
