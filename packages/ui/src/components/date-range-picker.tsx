import React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { dateRangeTextError, maskDateRange, parseDateRange } from "../lib/date-input";
import { useLatest } from "../hooks/use-latest";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { FieldError } from "./field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./popover";

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  className?: string;
  disabled?: boolean;
}

const toText = (range: DateRange | undefined) =>
  range?.from && range?.to
    ? `${format(range.from, "dd/MM/yyyy")} - ${format(range.to, "dd/MM/yyyy")}`
    : "";

export function DateRangePicker({
  value,
  onChange,
  className,
  disabled,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  // O período só é aplicado ao fechar o seletor: até lá, os cliques mexem apenas neste rascunho.
  const [draft, setDraft] = React.useState<DateRange | undefined>(value);
  // Primeiro clique define a âncora; o segundo completa o período (a menor data é sempre a inicial).
  const [anchor, setAnchor] = React.useState<Date | null>(null);

  const handleDayClick = (day: Date) => {
    if (!anchor) {
      setAnchor(day);
      setDraft({ from: day, to: day });
      return;
    }
    const [from, to] = day < anchor ? [day, anchor] : [anchor, day];
    setDraft({ from, to });
    setAnchor(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setDraft(value);
    } else if (
      !anchor &&
      draft?.from &&
      draft?.to &&
      (draft.from.getTime() !== value?.from?.getTime() || draft.to.getTime() !== value?.to?.getTime())
    ) {
      onChange(draft);
    }
    setAnchor(null);
    setOpen(next);
  };

  const [text, setText] = React.useState(toText(value));
  const [touched, setTouched] = React.useState(false);

  // Mudança de `value` causada pela própria digitação não reescreve o texto (senão apagaria o que o usuário digita).
  const typed = React.useRef(false);
  const valueRef = useLatest(value);
  const fromTime = value?.from?.getTime();
  const toTime = value?.to?.getTime();

  React.useEffect(() => {
    if (typed.current) {
      typed.current = false;
      return;
    }
    setText(toText(valueRef.current));
    setTouched(false);
  }, [fromTime, toTime]);

  const error = dateRangeTextError(text, touched);

  const handleTextChange = (raw: string) => {
    const masked = maskDateRange(raw);
    setText(masked);
    // Texto incompleto ou inválido nunca deixa o período anterior valendo: limpa.
    const next = parseDateRange(masked);
    typed.current = next?.from.getTime() !== value?.from?.getTime() || next?.to.getTime() !== value?.to?.getTime();
    onChange(next);
  };

  return (
    <>
    <InputGroup className={className}>
      <InputGroupInput
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder="dd/mm/aaaa - dd/mm/aaaa"
        disabled={disabled}
        aria-invalid={error !== undefined}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={() => setTouched(true)}
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger
            render={<Button variant="ghost" size="icon" disabled={disabled} aria-label="Abrir calendário" />}
          >
            <CalendarIcon />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              defaultMonth={value?.from}
              selected={draft}
              // Sem onSelect o react-day-picker usa estado interno e ignora `selected`; a seleção real vem de onDayClick.
              onSelect={() => undefined}
              onDayClick={handleDayClick}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
    {error ? <FieldError>{error}</FieldError> : null}
    </>
  );
}
