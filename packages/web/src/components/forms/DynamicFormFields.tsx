import React, { useEffect, useState } from "react";
import type { FormFieldDef } from "@platform/shared";
import type { UseFormReturn } from "react-hook-form";
import {
  FormField as FormFieldControl,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/components/ui/combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api-client";
import type { DynamicFormValues } from "@/lib/dynamic-form";

interface DynamicFormFieldsProps {
  fields: FormFieldDef[];
  form: UseFormReturn<DynamicFormValues>;
  recipeId: string;
}

type Option = { value: string | number; label: string };

function useFieldOptions(field: FormFieldDef, recipeId: string) {
  const hasLookup =
    ("lookup" in field && field.lookup !== undefined) ||
    (field.type === "multi_select" && "lookup" in field && (field as FormFieldDef & { lookup?: unknown }).lookup);
  const isLookup = hasLookup && !("options" in field);

  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
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
    api.lookups
      .fetch(recipeId, field.name)
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
  }, [field.name, recipeId, isLookup]);

  return { options, loading };
}

export const DynamicFormFields: React.FC<DynamicFormFieldsProps> = ({
  fields,
  form,
  recipeId,
}) => {
  return (
    <>
      {fields.map((field) => {
        switch (field.type) {
          case "textarea":
            return (
              <FormFieldControl
                key={field.name}
                control={form.control}
                name={field.name}
                render={({ field: rhf }) => (
                  <FormItem>
                    <FormLabel>{field.label}</FormLabel>
                    <FormControl>
                      <Textarea
                        value={String(rhf.value ?? "")}
                        disabled={field.readOnly}
                        required={field.required}
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

          case "switch":
            return (
              <FormFieldControl
                key={field.name}
                control={form.control}
                name={field.name}
                render={({ field: rhf }) => (
                  <FormItem className="flex flex-row items-center justify-between py-1">
                    <FormLabel>{field.label}</FormLabel>
                    <FormControl>
                      <Switch
                        checked={Boolean(rhf.value)}
                        disabled={field.readOnly}
                        onCheckedChange={rhf.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            );

          case "number":
          case "money":
            return (
              <FormFieldControl
                key={field.name}
                control={form.control}
                name={field.name}
                render={({ field: rhf }) => (
                  <FormItem>
                    <FormLabel>{field.label}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step={field.type === "money" ? "0.01" : "1"}
                        value={rhf.value !== undefined && rhf.value !== "" ? String(rhf.value) : ""}
                        disabled={field.readOnly}
                        required={field.required}
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

          case "select": {
            return (
              <FormFieldControl
                key={field.name}
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
                      <FormControl>
                        <Select
                          value={String(rhf.value ?? "")}
                          disabled={field.readOnly}
                          onValueChange={(val: string | null) => rhf.onChange(val ?? "")}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione uma opção" />
                          </SelectTrigger>
                          <SelectContent>
                            {normalized.map((opt) => (
                              <SelectItem key={String(opt.value)} value={String(opt.value)}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            );
          }

          case "lookup_select": {
            const { options, loading } = useFieldOptions(field, recipeId);

            return (
              <FormFieldControl
                key={field.name}
                control={form.control}
                name={field.name}
                render={({ field: rhf }) => (
                  <FormItem>
                    <FormLabel>{field.label}</FormLabel>
                    <FormControl>
                      {loading ? (
                        <Skeleton className="h-10 w-full" />
                      ) : (
                        <Select
                          value={String(rhf.value ?? "")}
                          disabled={field.readOnly}
                          onValueChange={(val: string | null) => rhf.onChange(val ?? "")}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione uma opção" />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map((opt) => (
                              <SelectItem key={String(opt.value)} value={String(opt.value)}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            );
          }

          case "multi_select": {
            const { options: rawOptions, loading } = useFieldOptions(field, recipeId);
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
                key={field.name}
                control={form.control}
                name={field.name}
                render={({ field: rhf }) => {
                  const currentIds: string[] = Array.isArray(rhf.value)
                    ? rhf.value.map(String)
                    : [];
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
          }

          case "date":
            return (
              <FormFieldControl
                key={field.name}
                control={form.control}
                name={field.name}
                render={({ field: rhf }) => (
                  <FormItem>
                    <FormLabel>{field.label}</FormLabel>
                    <FormControl>
                      <DatePicker
                        value={rhf.value ? new Date(rhf.value as string) : undefined}
                        onChange={(date) => rhf.onChange(date ? date.toISOString().slice(0, 10) : "")}
                        disabled={field.readOnly}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            );

          default:
            return (
              <FormFieldControl
                key={field.name}
                control={form.control}
                name={field.name}
                render={({ field: rhf }) => (
                  <FormItem>
                    <FormLabel>{field.label}</FormLabel>
                    <FormControl>
                      <Input
                        value={String(rhf.value ?? "")}
                        disabled={field.readOnly}
                        required={field.required}
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
        }
      })}
    </>
  );
};
