import React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { dateTextError, maskDate, parseDate } from "../lib/date-input";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { FieldError } from "./field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./popover";

interface DatePickerProps {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function DatePicker({
  value,
  onChange,
  className,
  disabled,
  placeholder = "dd/mm/aaaa",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(value ? format(value, "dd/MM/yyyy") : "");
  const [touched, setTouched] = React.useState(false);

  // Mudança de `value` causada pela própria digitação não reescreve o texto (senão apagaria o que o usuário digita).
  const typed = React.useRef(false);

  React.useEffect(() => {
    if (typed.current) {
      typed.current = false;
      return;
    }
    setText(value ? format(value, "dd/MM/yyyy") : "");
    setTouched(false);
  }, [value]);

  const error = dateTextError(text, touched);

  const handleChange = (raw: string) => {
    const masked = maskDate(raw);
    setText(masked);
    // Texto incompleto ou inválido nunca deixa o valor anterior valendo: limpa.
    const next = parseDate(masked);
    typed.current = next?.getTime() !== value?.getTime();
    onChange(next);
  };

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
          <PopoverTrigger
            render={<Button variant="ghost" size="icon" disabled={disabled} aria-label="Abrir calendário" />}
          >
            <CalendarIcon />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              selected={value}
              defaultMonth={value}
              onSelect={(date) => {
                onChange(date);
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
    {error ? <FieldError>{error}</FieldError> : null}
    </>
  );
}
