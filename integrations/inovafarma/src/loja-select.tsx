import { Alert, AlertDescription, AlertTitle } from "@platform/ui/components/alert";
import { Label } from "@platform/ui/components/label";
import { Stack } from "@platform/ui/components/layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@platform/ui/components/select";
import type { LojaOpcao } from "./loja-opcao";

const nomeDaLoja = (l: LojaOpcao) => l.nome || `Loja ${l.codigo}`;

/** Escolha da Loja (pelo código, como texto) entre as Lojas do Vínculo. */
export function LojaSelect({ lojas, value, onChange }: { lojas: LojaOpcao[]; value: string; onChange: (codigo: string) => void }) {
  return (
    <Stack gap="field">
      <Label>Loja</Label>
      <Select value={value} onValueChange={(v) => v && onChange(v)}>
        <SelectTrigger aria-label="Loja">
          <SelectValue>{(v: string) => lojas.find((l) => String(l.codigo) === v)?.nome || `Loja ${v}`}</SelectValue>
        </SelectTrigger>
        <SelectContent>
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
