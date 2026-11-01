import React from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonth, maskMonth, monthTextError, parseMonth } from "../lib/date-input";
import { Button } from "./button";
import { FieldError } from "./field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

interface MonthPickerProps {
  /** Mês e ano no formato `AAAA-MM`. */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

/** Campo de mês e ano: digita-se `mm/aaaa` ou escolhe-se no seletor, que navega de ano em ano. */
export function MonthPicker({ value, onChange, className, disabled, placeholder = "mm/aaaa" }: MonthPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(formatMonth(value));
  const [touched, setTouched] = React.useState(false);
  const [year, setYear] = React.useState(() => Number(value?.slice(0, 4)) || new Date().getFullYear());

  // Mudança de `value` causada pela própria digitação não reescreve o texto (senão apagaria o que o usuário digita).
  const typed = React.useRef(false);

  React.useEffect(() => {
    if (typed.current) {
      typed.current = false;
      return;
    }
    setText(formatMonth(value));
    setTouched(false);
  }, [value]);

  const error = monthTextError(text, touched);

  const handleChange = (raw: string) => {
    const masked = maskMonth(raw);
    setText(masked);
    // Texto incompleto ou inválido nunca deixa o valor anterior valendo: limpa.
    const next = parseMonth(masked);
    typed.current = next !== value;
    onChange(next);
    if (next) setYear(Number(next.slice(0, 4)));
  };

  const selectedMonth = value?.startsWith(`${year}-`) ? Number(value.slice(5, 7)) : undefined;

  return (
    <>
      <InputGroup className={className}>
        <InputGroupInput
          inputMode="numeric"
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error !== undefined}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        <InputGroupAddon align="inline-end">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button variant="ghost" size="icon" disabled={disabled} aria-label="Escolher mês" />}>
              <CalendarIcon />
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="end">
              <div className="flex items-center justify-between pb-2">
                <Button variant="ghost" size="icon" aria-label="Ano anterior" onClick={() => setYear((y) => y - 1)}>
                  <ChevronLeft />
                </Button>
                <span className="text-sm font-medium" aria-live="polite">
                  {year}
                </span>
                <Button variant="ghost" size="icon" aria-label="Próximo ano" onClick={() => setYear((y) => y + 1)}>
                  <ChevronRight />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {MONTH_NAMES.map((name, index) => (
                  <Button
                    key={name}
                    variant={selectedMonth === index + 1 ? "default" : "ghost"}
                    aria-pressed={selectedMonth === index + 1}
                    onClick={() => {
                      const next = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}`;
                      typed.current = false;
                      onChange(next);
                      setOpen(false);
                    }}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </InputGroupAddon>
      </InputGroup>
      {error ? <FieldError>{error}</FieldError> : null}
    </>
  );
}
