import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLatest } from "@platform/ui/hooks/use-latest";
import type { Device, IssuedDevice } from "@platform/shared";
import { Button } from "@platform/ui/components/button";
import { Badge } from "@platform/ui/components/badge";
import { Input } from "@platform/ui/components/input";
import { FieldGroup } from "@platform/ui/components/field";
import { PageHeader, Show, Spin, Stack, Text } from "@platform/ui/components/layout";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@platform/ui/components/form";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@platform/ui/components/dropdown-menu";
import { DataTable } from "@platform/ui/data-table/data-table";
import { useUi } from "@platform/ui/imperative/provider";
import { useWindow, WindowActions, WindowCancelButton } from "@platform/ui/imperative/use-window";
import { formatDate } from "@platform/ui/lib/format";
import { CheckCircle2, Ban, Copy, Download, MoreHorizontal, MonitorSmartphone, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api-client";
import { HeaderActions } from "@/context/HeaderActionsContext";

const deviceSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do Dispositivo.").max(100, "Use até 100 caracteres."),
});
type DeviceFormValues = z.infer<typeof deviceSchema>;

/** Entrega o .pfx como download. O arquivo só existe na resposta da emissão e não volta a ser mostrado. */
function downloadPfx(issued: IssuedDevice): void {
  const bytes = Uint8Array.from(atob(issued.pfx), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/x-pkcs12" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${issued.device.name.replace(/[^\p{L}\p{N}_-]+/gu, "-")}.pfx`;
  link.click();
  URL.revokeObjectURL(url);
}

const IssueDeviceWindow: React.FC = () => {
  const { resolve } = useWindow<IssuedDevice>();
  const ui = useUi();
  const form = useForm<DeviceFormValues>({
    resolver: zodResolver(deviceSchema),
    defaultValues: { name: "" },
  });

  const onSubmit = async (v: DeviceFormValues) => {
    try {
      const issued = await api.iam.issueDevice({ name: v.name.trim() });
      ui.feedback.notify({ type: "success", title: "Dispositivo emitido com sucesso." });
      resolve(issued);
    } catch (err: unknown) {
      ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Falha ao emitir o Dispositivo." });
    }
  };

  return (
    <>
      <Form {...form}>
        <form id="device-form" noValidate onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do Dispositivo</FormLabel>
                  <FormControl>
                    <Input placeholder="Ex: Caixa 1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FieldGroup>
        </form>
      </Form>
      <WindowActions>
        <WindowCancelButton />
        <Button type="submit" form="device-form" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Emitindo..." : "Emitir certificado"}
        </Button>
      </WindowActions>
    </>
  );
};

const CertificateIssuedWindow: React.FC<{ issued: IssuedDevice }> = ({ issued }) => {
  const { resolve } = useWindow<boolean>();
  const ui = useUi();
  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(issued.password);
      ui.feedback.notify({ type: "success", title: "Senha copiada com sucesso." });
    } catch {
      ui.feedback.notify({ type: "error", title: "Falha ao copiar a senha. Selecione e copie manualmente." });
    }
  };
  return (
    <>
      <Stack gap="section">
        <Text tone="muted">
          Entregue o arquivo e a senha a quem vai instalar o certificado em <Text as="strong" weight="semibold">{issued.device.name}</Text>.
          A senha aparece só agora: o Celestia não guarda a senha nem o arquivo. Se algum dos dois se perder, revogue o Dispositivo e emita outro.
        </Text>
        <Stack gap="tight">
          <Text variant="eyebrow" tone="muted">
            Senha do certificado
          </Text>
          <Stack direction="row" align="center" gap="field">
            <Text variant="mono" weight="semibold">
              {issued.password}
            </Text>
            <Button variant="outline" size="icon" aria-label="Copiar senha" onClick={copyPassword}>
              <Copy />
            </Button>
          </Stack>
        </Stack>
      </Stack>
      <WindowActions>
        <Button variant="outline" onClick={() => downloadPfx(issued)}>
          <Download />
          Baixar certificado
        </Button>
        <Button onClick={() => resolve(true)}>Concluir</Button>
      </WindowActions>
    </>
  );
};

export const IAMDevicesPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const ui = useUi();
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      setLoading(true);
      setDevices(await api.iam.listDevices());
    } catch (err: unknown) {
      ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Erro ao carregar os Dispositivos." });
    } finally {
      setLoading(false);
    }
  };

  const fetchDataRef = useLatest(fetchData);
  useEffect(() => {
    fetchDataRef.current();
  }, [fetchDataRef]);

  const openIssueWindow = async () => {
    const result = await ui.windows.open<IssuedDevice>({
      surface: "dialog",
      size: "small",
      title: "Novo Dispositivo",
      description: "Homologue um computador ou celular. O Celestia emite o certificado que ele usa para acessar o sistema.",
      content: () => <IssueDeviceWindow />,
    });
    if (result.status !== "confirmed") return;
    fetchData();
    await ui.windows.open<boolean>({
      surface: "dialog",
      size: "small",
      title: "Certificado emitido",
      description: `O certificado de "${result.value.device.name}" está pronto.`,
      content: () => <CertificateIssuedWindow issued={result.value} />,
    });
  };

  const handleRevoke = async (device: Device) => {
    const confirmed = await ui.windows.confirm({
      title: "Revogar Dispositivo",
      description: `Revogar o certificado do Dispositivo "${device.name}"? Ele perde o acesso ao sistema e não pode ser reativado.`,
      confirmLabel: "Revogar",
    });
    if (!confirmed) return;
    try {
      await api.iam.revokeDevice(device.id);
      ui.feedback.notify({ type: "success", title: "Certificado revogado com sucesso." });
      fetchData();
    } catch (err: unknown) {
      ui.feedback.notify({ type: "error", title: err instanceof Error ? err.message : "Falha ao revogar o Dispositivo." });
    }
  };

  const canCreate = hasPermission("system:devices:create");

  return (
    <Stack gap="section">
      <HeaderActions>
        <Button variant="outline" size="icon" aria-label="Atualizar" onClick={fetchData} disabled={loading}>
          <Spin active={loading}>
            <RefreshCw />
          </Spin>
        </Button>

        {canCreate && (
          <Show on="lgUp">
            <Button onClick={openIssueWindow}>
              <MonitorSmartphone />
              Novo Dispositivo
            </Button>
          </Show>
        )}

        {canCreate && (
          <Show on="belowLg">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={openIssueWindow}>
                  <MonitorSmartphone />
                  Novo Dispositivo
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Show>
        )}
      </HeaderActions>

      <PageHeader title="Dispositivos" description="Computadores e celulares homologados a acessar o sistema, cada um com o próprio certificado." />

      <DataTable<Device>
        rows={devices}
        getRowId={(d) => d.id}
        loading={loading}
        title={(count) => `Dispositivos Homologados (${count})`}
        emptyMessage="Nenhum Dispositivo encontrado."
        search={{ placeholder: "Buscar por nome..." }}
        columns={[
          {
            key: "name",
            label: "Nome",
            value: (d) => d.name,
            searchable: true,
            cellClassName: "font-medium",
            skeletonClassName: "h-4 w-40",
            mobileRole: "primary",
          },
          {
            key: "status",
            label: "Estado",
            value: (d) => d.status,
            render: (d) =>
              d.status === "active" ? (
                <Badge variant="secondary">
                  <CheckCircle2 />
                  Ativo
                </Badge>
              ) : (
                <Badge variant="default">
                  <Ban />
                  Revogado
                </Badge>
              ),
            skeletonClassName: "h-5 w-20",
          },
          {
            key: "notAfter",
            label: "Validade",
            value: (d) => formatDate(d.notAfter),
            cellClassName: "text-xs text-muted-foreground",
            skeletonClassName: "h-4 w-24",
            mobileRole: "secondary",
          },
          {
            key: "createdAt",
            label: "Emitido em",
            value: (d) => formatDate(d.createdAt),
            cellClassName: "text-xs text-muted-foreground",
            skeletonClassName: "h-4 w-24",
          },
        ]}
        rowActions={(d) =>
          hasPermission("system:devices:revoke") && d.status === "active" ? (
            <Stack direction="row" justify="end" gap="tight">
              <Button
                variant="ghost"
                tone="destructive"
                size="icon"
                aria-label="Revogar Dispositivo"
                title="Revogar Dispositivo"
                onClick={() => handleRevoke(d)}
              >
                <Ban />
              </Button>
            </Stack>
          ) : null
        }
      />
    </Stack>
  );
};
