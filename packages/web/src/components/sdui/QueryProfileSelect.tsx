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
} from "@platform/ui/components/select";

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

  // Perfil com mais de uma consulta/persistência: a lista mostra o detalhe de cada uma para diferenciar os perfis.
  const describe = (profile: ComponentProfileMeta): string =>
    profile.bindings.length > 1
      ? [
          profile.label,
          profile.bindings
            .map((binding) => `${binding.queryName || binding.persistenceName || binding.id}: ${binding.optionLabel || "Persistência"}`)
            .join(" · "),
        ].join(" — ")
      : profile.label;

  return (
    <Select
      items={profiles.map((profile) => ({ value: profile.id, label: profile.label }))}
      value={value ?? profiles[0].id}
      onValueChange={(nextValue: string | null) => {
        if (nextValue) onValueChange(nextValue);
      }}
    >
      <SelectTrigger aria-label="Visão" className="w-auto min-w-40 max-w-64">
        <SelectValue placeholder="Visão" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="w-max min-w-(--anchor-width)">
        <SelectGroup>
          <SelectLabel>Visão</SelectLabel>
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {describe(profile)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};
