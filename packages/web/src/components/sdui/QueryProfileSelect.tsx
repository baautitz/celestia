import React from "react";
import type { ComponentProfileMeta } from "@platform/shared";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QueryProfileSelectProps {
  profiles?: ComponentProfileMeta[];
  value?: string;
  onValueChange: (value: string) => void;
}

export const QueryProfileSelect: React.FC<QueryProfileSelectProps> = ({
  profiles = [],
  value,
  onValueChange,
}) => {
  if (profiles.length === 0) return null;

  return (
    <Select
      value={value ?? profiles[0].id}
      onValueChange={(nextValue: string | null) => {
        if (nextValue) onValueChange(nextValue);
      }}
    >
      <SelectTrigger aria-label="Perfil de dados" className="w-40">
        <SelectValue placeholder="Perfil de dados" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="w-max min-w-(--anchor-width)">
        <SelectGroup>
          <SelectLabel>Perfil de dados</SelectLabel>
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {[
                profile.label,
                profile.bindings
                  .map((binding) => {
                    const bindingName = binding.queryName || binding.persistenceName || binding.id;
                    const bindingValue = binding.optionLabel || "Persistência";
                    return `${bindingName}: ${bindingValue}`;
                  })
                  .join(" · "),
              ]
                .filter(Boolean)
                .join(" — ")}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};
