import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Editor from "@monaco-editor/react";
import { ArrowLeft, Download, Save, Upload } from "lucide-react";
import "@/lib/monaco";
import { useAuth } from "@/context/AuthContext";
import { useRecipesCatalog } from "@/context/RecipesCatalogContext";
import { HeaderActions } from "@/context/HeaderActionsContext";
import { api } from "@/lib/api-client";
import { downloadSource } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import {
  Form,
  FormField,
  FormItem,
  FormControl,
  FormMessage,
} from "@/components/ui/form";

const formSchema = z.object({
  source: z.string().min(1, "Escreva o Dashboard ou carregue um arquivo .ts."),
});

const BOILERPLATE = `import { defineRecipe } from "@platform/shared";

export default defineRecipe({
  id: "novo_dashboard",
  name: "Novo Dashboard",
  description: "Descreva o objetivo deste Dashboard.",

  workspace: {
    params: [
      { name: "start_date", label: "Data Inicial", type: "date", required: true },
      { name: "end_date", label: "Data Final", type: "date", required: true },
    ],
  },

  sources: {
    erp: {
      queries: {
        registros: {
          primaryKey: "id",
          columns: [
            { name: "id", type: "number", label: "ID" },
            { name: "nome", type: "text", label: "Nome" },
          ],
          options: [
            {
              id: "todos",
              label: "Todos",
              sql: \`
                SELECT id, nome
                FROM tabela
                WHERE data BETWEEN {{workspace.start_date}} AND {{workspace.end_date}}
              \`,
            },
          ],
        },
      },
    },
  },

  persistence: [],

  actions: [],

  ui: {
    layout: { type: "grid", columns: 12, gap: 16 },
    components: [
      {
        id: "tabela",
        component: "data_table",
        layoutProps: { colSpan: 12 },
        props: {
          title: "Registros",
          source: "erp",
          query: "registros",
          columns: [
            { key: "id", label: "ID", sortable: true },
            { key: "nome", label: "Nome", sortable: true, searchable: true },
          ],
          pagination: { pageSize: 10 },
        },
      },
    ],
  },
});
`;

type FormValues = z.infer<typeof formSchema>;

export const RecipeEditorPage: React.FC = () => {
  const { id: editingId } = useParams<{ id: string }>();
  const isEditMode = editingId !== undefined;
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("system:recipes:manage");
  const { refresh: refreshSidebar } = useRecipesCatalog();

  const [loading, setLoading] = useState(isEditMode);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { source: isEditMode ? "" : BOILERPLATE },
  });

  useEffect(() => {
    if (!editingId) return;
    api.recipeAdmin
      .get(editingId)
      .then((record) => form.reset({ source: record.source }))
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Erro ao carregar o Dashboard");
        navigate("/admin/dashboards");
      })
      .finally(() => setLoading(false));
  }, [editingId, form, navigate]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    form.setValue("source", text, { shouldValidate: true });
    e.target.value = "";
  };

  const handleSave = async (values: FormValues) => {
    try {
      // O identificador vem do `id` declarado no próprio código.
      const id = values.source.match(/\bid:\s*["']([a-z][a-z0-9_]*)["']/)?.[1];
      if (!id) {
        form.setError("source", { message: 'Declare o `id` do Dashboard (ex.: id: "fechamento_mes").' });
        return;
      }
      if (editingId && id !== editingId) {
        form.setError("source", { message: `O \`id\` deve continuar "${editingId}".` });
        return;
      }
      setSaving(true);
      await api.recipeAdmin.save(id, values.source);
      toast.success(isEditMode ? "Dashboard atualizado com sucesso!" : "Dashboard cadastrado com sucesso!");
      refreshSidebar();
      navigate("/admin/dashboards");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar Dashboard");
    } finally {
      setSaving(false);
    }
  };

  const isDark = document.documentElement.classList.contains("dark");

  return (
    <Form {...form}>
      <form
        id="recipe-form"
        onSubmit={form.handleSubmit(handleSave)}
        className="flex flex-1 flex-col gap-4 lg:flex-row"
        noValidate
      >
        <HeaderActions>
          <Button type="button" variant="outline" onClick={() => navigate("/admin/dashboards")}>
            <ArrowLeft className="size-3.5 mr-1.5" />
            Voltar
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => {
              const source = form.getValues("source");
              const id = source.match(/\bid:\s*["']([a-z][a-z0-9_]*)["']/)?.[1] ?? editingId ?? "dashboard";
              downloadSource(id, source);
            }}
          >
            <Download className="size-3.5 mr-1.5" />
            Baixar .ts
          </Button>
          {canManage && (
            <Button form="recipe-form" type="submit" disabled={saving || loading}>
              <Save className="size-3.5 mr-1.5" />
              {saving ? "Compilando e salvando..." : "Salvar"}
            </Button>
          )}
        </HeaderActions>

        <FormField
          control={form.control}
          name="source"
          render={({ field }) => (
            <FormItem className="flex-1 min-w-0">
              <FormControl>
                {loading ? (
                  <Skeleton className="h-96" />
                ) : (
                  <Editor
                    height="calc(100svh - 8.5rem)"
                    path="file:///recipe.ts"
                    language="typescript"
                    theme={isDark ? "vs-dark" : "celestia-light"}
                    value={field.value}
                    onChange={(value) => field.onChange(value ?? "")}
                    onMount={(editor, monaco) => {
                      editor.addCommand(monaco.KeyCode.F12, () => {
                        editor.getAction("editor.action.peekDefinition")?.run();
                      });
                    }}
                    options={{
                      readOnly: !canManage,
                      minimap: { enabled: false },
                      stickyScroll: { enabled: false },
                      automaticLayout: true,
                      tabSize: 2,
                      scrollBeyondLastLine: false,
                    }}
                  />
                )}
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {canManage && (
          <Card className="lg:w-80 shrink-0 self-start">
            <CardContent>
              <Field className="gap-2">
                <FieldLabel>Carregar arquivo .ts</FieldLabel>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".ts,text/plain"
                  className="hidden"
                  onChange={handleFile}
                />
                <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="size-3.5 mr-1.5" />
                  Escolher arquivo
                </Button>
                <FieldDescription>Substitui o conteúdo do editor.</FieldDescription>
              </Field>
            </CardContent>
          </Card>
        )}
      </form>
    </Form>
  );
};
