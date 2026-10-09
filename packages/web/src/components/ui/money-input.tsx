import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface MoneyInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange"> {
  value?: number | string | null;
  defaultValue?: number | string | null;
  onValueChange?: (value: number, rawString: string) => void;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  prefix?: string;
  precision?: number;
  allowNegative?: boolean;
}

function formatMoney(
  value: number,
  precision: number = 2,
  prefix: string = "R$ "
): string {
  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
  return `${prefix}${formatted}`;
}

function toDisplayString(
  val: number | string | undefined | null,
  precision: number,
  prefix: string,
  allowNegative: boolean
): string {
  if (val === undefined || val === null || val === "") return "";
  const num = typeof val === "number" ? val : Number(val);
  if (isNaN(num)) return "";
  const isNegative = allowNegative && num < 0;
  const absFormatted = formatMoney(Math.abs(num), precision, prefix);
  return isNegative ? `-${absFormatted}` : absFormatted;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    {
      value,
      defaultValue,
      onValueChange,
      onChange,
      prefix = "R$ ",
      precision = 2,
      allowNegative = false,
      placeholder,
      className,
      onFocus,
      onClick,
      onKeyUp,
      ...props
    },
    ref
  ) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const setRefs = (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    };

    // Valor monetário preenche da direita para a esquerda: o cursor fica sempre no final.
    const moveCaretToEnd = () => {
      const el = innerRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    };

    const initialVal = value !== undefined ? value : defaultValue;
    const [displayValue, setDisplayValue] = React.useState(() =>
      toDisplayString(initialVal, precision, prefix, allowNegative)
    );

    React.useEffect(() => {
      if (value !== undefined) {
        setDisplayValue(toDisplayString(value, precision, prefix, allowNegative));
      }
    }, [value, precision, prefix, allowNegative]);

    React.useLayoutEffect(() => {
      if (document.activeElement === innerRef.current) moveCaretToEnd();
    }, [displayValue]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const isNegative = allowNegative && raw.startsWith("-");
      const digits = raw.replace(/\D/g, "");

      if (digits === "") {
        setDisplayValue("");
        onValueChange?.(0, "");
        if (onChange) {
          e.target.value = "";
          onChange(e);
        }
        return;
      }

      const numericVal = (Number(digits) / Math.pow(10, precision)) * (isNegative ? -1 : 1);
      const absFormatted = formatMoney(Math.abs(numericVal), precision, prefix);
      const formatted = isNegative ? `-${absFormatted}` : absFormatted;

      setDisplayValue(formatted);
      onValueChange?.(numericVal, formatted);

      if (onChange) {
        e.target.value = String(numericVal);
        onChange(e);
      }
    };

    return (
      <Input
        ref={setRefs}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={displayValue}
        placeholder={placeholder || `${prefix}0,00`}
        className={cn("tabular-nums", className)}
        onChange={handleChange}
        onFocus={(e) => {
          onFocus?.(e);
          requestAnimationFrame(moveCaretToEnd);
        }}
        onClick={(e) => {
          onClick?.(e);
          moveCaretToEnd();
        }}
        onKeyUp={(e) => {
          onKeyUp?.(e);
          if (e.key.startsWith("Arrow") || e.key === "Home") moveCaretToEnd();
        }}
        {...props}
      />
    );
  }
);

MoneyInput.displayName = "MoneyInput";
