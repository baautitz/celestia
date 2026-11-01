import React from "react";
import { Card, CardContent, CardFooter } from "./card";
import { Separator } from "./separator";
import { cn } from "../lib/utils";

interface MobileCardField {
  label: string;
  value: React.ReactNode;
  /** Ocupa a linha inteira do card (ex.: controle editável). */
  wide?: boolean;
}

interface MobileCardProps {
  primary: string;
  secondary?: string;
  fields: MobileCardField[];
  actions?: React.ReactNode;
  details?: React.ReactNode;
}

export const MobileCard: React.FC<MobileCardProps> = ({
  primary,
  secondary,
  fields,
  actions,
  details,
}) => {
  return (
    <Card size="sm">
      <CardContent>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold leading-none">{primary}</span>
          {secondary && (
            <span className="font-mono text-xs text-muted-foreground">{secondary}</span>
          )}
        </div>

        <Separator className="my-3" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {fields.map((field) => (
            <div key={field.label} className={cn("flex min-w-0 flex-col gap-0.5", field.wide && "col-span-2")}>
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {field.label}
              </span>
              <span className="text-sm font-medium break-words">{field.value}</span>
            </div>
          ))}
        </div>

        {details && (
          <>
            <Separator className="my-3" />
            <div className="text-sm">{details}</div>
          </>
        )}
      </CardContent>

      {actions && (
        <>
          <CardFooter className="justify-end py-1">
            {actions}
          </CardFooter>
        </>
      )}
    </Card>
  );
};
