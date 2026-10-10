import React from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  className?: string;
  disabled?: boolean;
}

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

  const formatDateShort = (date: Date) =>
    format(date, "dd 'de' MMM", { locale: ptBR });

  const formatDateFull = (date: Date) =>
    format(date, "dd 'de' MMMM 'de' yyyy", { locale: ptBR });

  const label =
    value?.from && value?.to
      ? `${formatDateShort(value.from)} — ${formatDateShort(value.to)} ${value.to.getFullYear()}`
      : value?.from
        ? formatDateFull(value.from)
        : "Selecione o período";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            data-empty={!value?.from}
            disabled={disabled}
            className={cn(
              "h-8 justify-start gap-2 text-left font-normal text-sm data-[empty=true]:text-muted-foreground",
              className
            )}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
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
  );
}
