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
    <Popover open={open} onOpenChange={setOpen}>
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
          selected={value}
          onSelect={onChange}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}
