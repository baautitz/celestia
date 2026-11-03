import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import type { LojaOpcao } from "./loja-opcao";

const nomeDaLoja = (l: LojaOpcao) => l.nome || `Loja ${l.codigo}`;

/** Valor da opção que junta todas as Lojas da lista. */
export const TODAS_AS_LOJAS = "all";

/**
 * Escolha da Loja (pelo código, como texto) entre as Lojas da lista. Com `todas`, a primeira opção (valor
 * `TODAS_AS_LOJAS`) junta todas, com esse rótulo.
 */
export function LojaSelect({ lojas, value, onChange, todas }: { lojas: LojaOpcao[]; value: string; onChange: (codigo: string) => void; todas?: string }) {
  return (
    <Stack gap="field">
      <Label>Loja</Label>
      <Select value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger aria-label="Loja">
          <SelectValue>{(v: string) => (v === TODAS_AS_LOJAS && todas ? todas : lojas.find((l) => String(l.codigo) === v)?.nome || `Loja ${v}`)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {todas && <SelectItem value={TODAS_AS_LOJAS}>{todas}</SelectItem>}
          {lojas.map((l) => (
            <SelectItem key={l.codigo} value={String(l.codigo)}>
              {nomeDaLoja(l)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Stack>
  );
}

/** Aviso de quem não tem Lojas no Vínculo. */
export function SemLojas() {
  return (
    <Alert variant="destructive">
      <AlertTitle>Sem Lojas</AlertTitle>
      <AlertDescription>Seu Usuário não está vinculado a um Colaborador com Lojas. Peça o vínculo a quem administra os Colaboradores.</AlertDescription>
    </Alert>
  );
}
