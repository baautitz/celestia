import React, { useEffect, useState } from "react";
import { parseLocalDate, toLocalISODate } from "../lib/utils";
import type { FormFieldDef } from "@platform/shared";
import type { UseFormReturn } from "react-hook-form";
import {
  FormField as FormFieldControl,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "../components/form";
import { useLatest } from "../hooks/use-latest";
import { Input } from "../components/input";
import { MoneyInput } from "../components/money-input";
import { PasswordInput } from "../components/password-input";
import { Textarea } from "../components/textarea";
import { Switch } from "../components/switch";
import { DatePicker } from "../components/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "../components/combobox";
import { Skeleton } from "../components/skeleton";
import type { DynamicFormValues } from "./dynamic-form";

interface DynamicFormFieldsProps {
  fields: FormFieldDef[];
  form: UseFormReturn<DynamicFormValues>;
  /** Resolve as opções de um campo com lookup (injetado pelo consumidor). */
  fetchLookupOptions?: (field: FormFieldDef) => Promise<Option[]>;
}

export type Option = { value: string | number; label: string };

function useFieldOptions(field: FormFieldDef, fetchLookupOptions?: (field: FormFieldDef) => Promise<Option[]>) {
  const hasLookup =
    ("lookup" in field && field.lookup !== undefined) ||
    (field.type === "multi_select" && "lookup" in field && (field as FormFieldDef & { lookup?: unknown }).lookup);
  const isLookup = hasLookup && !("options" in field);

  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const fieldRef = useLatest(field);

  useEffect(() => {
    const field = fieldRef.current;
    if (!isLookup) {
      const opts: Option[] = [];
      if ("options" in field && field.options) {
        for (const opt of field.options) {
          opts.push(typeof opt === "string" ? { value: opt, label: opt } : { value: opt.value, label: opt.label });
        }
      }
      setOptions(opts);
      return;
    }

    const lookup = (field as FormFieldDef & { lookup: { query: string } }).lookup;
    if (!lookup) return;

    let cancelled = false;
    setLoading(true);
    if (!fetchLookupOptions) return;
    fetchLookupOptions(field)
      .then((res) => {
        if (!cancelled) setOptions(res.filter((opt) => opt.label !== ""));
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [field.name, fetchLookupOptions, isLookup, fieldRef]);

  return { options, loading };
}

type FieldOf<T extends FormFieldDef["type"]> = Extract<FormFieldDef, { type: T }>;

interface FieldProps<F extends FormFieldDef = FormFieldDef> {
  field: F;
  form: UseFormReturn<DynamicFormValues>;
  fetchLookupOptions?: (field: FormFieldDef) => Promise<Option[]>;
}

const TextareaField: React.FC<FieldProps<FieldOf<"textarea">>> = ({ field, form }) => (
  <FormFieldControl
    control={form.control}
    name={field.name}
    render={({ field: rhf }) => (
      <FormItem>
        <FormLabel>{field.label}</FormLabel>
        <FormControl>
          <Textarea
            value={String(rhf.value ?? "")}
            disabled={field.readOnly}
            onChange={rhf.onChange}
            onBlur={rhf.onBlur}
            name={rhf.name}
            ref={rhf.ref}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

const PasswordField: React.FC<FieldProps<FieldOf<"password">>> = ({ field, form }) => (
  <FormFieldControl
    control={form.control}
    name={field.name}
    render={({ field: rhf }) => (
      <FormItem>
        <FormLabel>{field.label}</FormLabel>
        <FormControl>
          <PasswordInput
            autoComplete="new-password"
            placeholder={field.placeholder}
            value={String(rhf.value ?? "")}
            disabled={field.readOnly}
            onChange={rhf.onChange}
            onBlur={rhf.onBlur}
            name={rhf.name}
            ref={rhf.ref}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

const SwitchField: React.FC<FieldProps<FieldOf<"switch">>> = ({ field, form }) => (
  <FormFieldControl
    control={form.control}
    name={field.name}
    render={({ field: rhf }) => (
      <FormItem className="flex flex-row items-center justify-between py-1">
        <FormLabel>{field.label}</FormLabel>
        <FormControl>
          <Switch checked={Boolean(rhf.value)} disabled={field.readOnly} onCheckedChange={rhf.onChange} />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

const MoneyField: React.FC<FieldProps<FieldOf<"money">>> = ({ field, form }) => (
  <FormFieldControl
    control={form.control}
    name={field.name}
    render={({ field: rhf }) => (
      <FormItem>
        <FormLabel>{field.label}</FormLabel>
        <FormControl>
          <MoneyInput
            value={rhf.value as number | string | undefined}
            disabled={field.readOnly}
            prefix={field.prefix || "R$ "}
            precision={field.precision ?? 2}
            allowNegative={field.allowNegative ?? false}
            onValueChange={(val) => rhf.onChange(val)}
            onBlur={rhf.onBlur}
            name={rhf.name}
            ref={rhf.ref}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

const NumberField: React.FC<FieldProps<FieldOf<"number">>> = ({ field, form }) => (
  <FormFieldControl
    control={form.control}
    name={field.name}
    render={({ field: rhf }) => (
      <FormItem>
        <FormLabel>{field.label}</FormLabel>
        <FormControl>
          <Input
            type="number"
            step={field.step ?? 1}
            value={rhf.value !== undefined && rhf.value !== "" ? String(rhf.value) : ""}
            disabled={field.readOnly}
            onChange={(e) => rhf.onChange(e.target.value === "" ? "" : Number(e.target.value))}
            onBlur={rhf.onBlur}
            name={rhf.name}
            ref={rhf.ref}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

const SelectField: React.FC<FieldProps<FieldOf<"select">>> = ({ field, form }) => (
  <FormFieldControl
    control={form.control}
    name={field.name}
    render={({ field: rhf }) => {
      const rawOpts = field.options || [];
      const normalized = rawOpts.map((opt) =>
        typeof opt === "string" ? { value: opt, label: opt } : { value: String(opt.value), label: opt.label }
      );

      return (
        <FormItem>
          <FormLabel>{field.label}</FormLabel>
          <Select
            items={normalized.map((opt) => ({ value: String(opt.value), label: opt.label }))}
            value={String(rhf.value ?? "")}
            disabled={field.readOnly}
            onValueChange={(val: string | null) => rhf.onChange(val ?? "")}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma opção" />
              </SelectTrigger>
            </FormControl>
            <SelectContent alignItemWithTrigger={false} className="w-max min-w-(--anchor-width)">
              {normalized.map((opt) => (
                <SelectItem key={String(opt.value)} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      );
    }}
  />
);

const LookupSelectField: React.FC<FieldProps<FieldOf<"lookup_select">>> = ({ field, form, fetchLookupOptions }) => {
  const { options, loading } = useFieldOptions(field, fetchLookupOptions);

  return (
    <FormFieldControl
      control={form.control}
      name={field.name}
      render={({ field: rhf }) => (
        <FormItem>
          <FormLabel>{field.label}</FormLabel>
          {loading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              items={options.map((opt) => ({ value: String(opt.value), label: opt.label }))}
              value={String(rhf.value ?? "")}
              disabled={field.readOnly}
              onValueChange={(val: string | null) => rhf.onChange(val ?? "")}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma opção" />
                </SelectTrigger>
              </FormControl>
              <SelectContent alignItemWithTrigger={false} className="w-max min-w-(--anchor-width)">
                {options.map((opt) => (
                  <SelectItem key={String(opt.value)} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
};

const MultiSelectField: React.FC<FieldProps<FieldOf<"multi_select">>> = ({ field, form, fetchLookupOptions }) => {
  const { options: rawOptions, loading } = useFieldOptions(field, fetchLookupOptions);
  const anchor = useComboboxAnchor();
  const normalized = rawOptions
    .filter((opt) => opt.label !== "")
    .map((opt) => ({
      value: String(opt.value),
      label: opt.label,
    }));

  if (!loading && normalized.length === 0) {
    return null;
  }

  return (
    <FormFieldControl
      control={form.control}
      name={field.name}
      render={({ field: rhf }) => {
        const currentIds: string[] = Array.isArray(rhf.value) ? rhf.value.map(String) : [];
        const selectedItems = normalized.filter((opt) => currentIds.includes(opt.value));

        return (
          <FormItem>
            <FormLabel>{field.label}</FormLabel>
            <FormControl>
              {loading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Combobox
                  multiple
                  autoHighlight
                  items={normalized}
                  value={selectedItems}
                  onValueChange={(items: { value: string; label: string }[]) =>
                    rhf.onChange(items.map((item) => item.value))
                  }
                  itemToStringValue={(item) => item.label}
                  disabled={field.readOnly}
                >
                  <ComboboxChips ref={anchor} className="w-full">
                    <ComboboxValue>
                      {(values: { value: string; label: string }[]) => (
                        <>
                          {values.map((item) => (
                            <ComboboxChip key={item.value}>{item.label}</ComboboxChip>
                          ))}
                          <ComboboxChipsInput placeholder={`Buscar ${field.label.toLowerCase()}...`} />
                        </>
                      )}
                    </ComboboxValue>
                  </ComboboxChips>
                  <ComboboxContent anchor={anchor}>
                    <ComboboxEmpty>Nenhum item encontrado.</ComboboxEmpty>
                    <ComboboxList>
                      {(item) => (
                        <ComboboxItem key={item.value} value={item}>
                          {item.label}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              )}
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
};

const DateField: React.FC<FieldProps<FieldOf<"date">>> = ({ field, form }) => (
  <FormFieldControl
    control={form.control}
    name={field.name}
    render={({ field: rhf }) => (
      <FormItem>
        <FormLabel>{field.label}</FormLabel>
        <FormControl>
          <DatePicker
            value={rhf.value ? parseLocalDate(rhf.value as string) : undefined}
            onChange={(date) => rhf.onChange(date ? toLocalISODate(date) : "")}
            disabled={field.readOnly}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

const DefaultField: React.FC<FieldProps> = ({ field, form }) => (
  <FormFieldControl
    control={form.control}
    name={field.name}
    render={({ field: rhf }) => (
      <FormItem>
        <FormLabel>{field.label}</FormLabel>
        <FormControl>
          <Input
            value={String(rhf.value ?? "")}
            disabled={field.readOnly}
            onChange={rhf.onChange}
            onBlur={rhf.onBlur}
            name={rhf.name}
            ref={rhf.ref}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);

const DynamicField: React.FC<FieldProps> = ({ field, form, fetchLookupOptions }) => {
  switch (field.type) {
    case "textarea":
      return <TextareaField field={field} form={form} />;
    case "password":
      return <PasswordField field={field} form={form} />;
    case "switch":
      return <SwitchField field={field} form={form} />;
    case "money":
      return <MoneyField field={field} form={form} />;
    case "number":
      return <NumberField field={field} form={form} />;
    case "select":
      return <SelectField field={field} form={form} />;
    case "lookup_select":
      return <LookupSelectField field={field} form={form} fetchLookupOptions={fetchLookupOptions} />;
    case "multi_select":
      return <MultiSelectField field={field} form={form} fetchLookupOptions={fetchLookupOptions} />;
    case "date":
      return <DateField field={field} form={form} />;
    default:
      return <DefaultField field={field} form={form} />;
  }
};

export const DynamicFormFields: React.FC<DynamicFormFieldsProps> = ({ fields, form, fetchLookupOptions }) => {
  return (
    <>
      {fields.map((field) => (
        <DynamicField key={field.name} field={field} form={form} fetchLookupOptions={fetchLookupOptions} />
      ))}
    </>
  );
};
