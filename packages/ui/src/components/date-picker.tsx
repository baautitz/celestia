import React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { maskDate, parseDate } from "../lib/date-input";
import { Button } from "./button";
import { Calendar } from "./calendar";
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

  React.useEffect(() => {
    setText(value ? format(value, "dd/MM/yyyy") : "");
    setTouched(false);
  }, [value]);

  const invalid = text !== "" && !parseDate(text) && (touched || text.length === 10);

  const handleChange = (raw: string) => {
    const masked = maskDate(raw);
    setText(masked);
    if (masked === "") onChange(undefined);
    else {
      const parsed = parseDate(masked);
      if (parsed) onChange(parsed);
    }
  };

  return (
    <InputGroup className={className}>
      <InputGroupInput
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid}
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
  );
}
