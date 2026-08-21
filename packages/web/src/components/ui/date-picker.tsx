import React from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
  placeholder = "Selecione uma data",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            data-empty={!value}
            disabled={disabled}
            className={cn(
              "justify-start text-left font-normal data-[empty=true]:text-muted-foreground",
              className
            )}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        <span className="truncate">
          {value ? format(value, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : placeholder}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={onChange}
        />
      </PopoverContent>
    </Popover>
  );
}
