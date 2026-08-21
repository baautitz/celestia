import type { FormFieldDef } from "./fields.js";

/**
 * Efeitos declarativos retornados pelo backend para o frontend processar.
 */
export type UIEffect =
  | { type: "toast"; variant: "success" | "error" | "warning" | "info"; message: string }
  | { type: "refresh_data" }
  | { type: "open_dialog"; actionId: string; options: OpenDialogOptions }
  | { type: "confirm"; actionId: string; title: string; message: string }
  | { type: "show_table"; actionId: string; options: ShowTableOptions; row: Record<string, unknown> }
  | { type: "close_dialog"; dialogId?: string }
  | { type: "download"; filename: string; content: string; mimeType: string }
  | { type: "print"; content: string };

/**
 * Configuração para abertura imperativa de Dialogs.
 */
export interface OpenDialogOptions {
  title: string;
  description?: string;
  fields: FormFieldDef[];
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Configuração para exibição imperativa de Sub-Tabelas.
 */
export interface ShowTableOptions {
  title: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  source: string;
  columns: Array<{
    key: string;
    label: string;
    format?: "currency" | "datetime" | "date" | "number" | "text";
  }>;
  rowActions?: string[];
  isWorkspaceClosed?: boolean;
}

/**
 * Configuração para Assistente em Etapas (Wizard).
 */
export interface WizardOptions {
  title: string;
  steps: Array<{
    title: string;
    description?: string;
    fields: FormFieldDef[];
  }>;
}

/**
 * Interface da API imperativa 'ui.*' disponível dentro das actions.
 */
export interface ImperativeUIContext {
  /** Exibe diálogo de confirmação com botões 'Confirmar' e 'Cancelar'. */
  confirm(title: string, message: string): Promise<boolean>;

  /** Exibe popup de entrada rápida de texto. */
  prompt(title: string, label: string, defaultValue?: string): Promise<string | null>;

  /** Exibe modal simples de aviso com botão 'OK'. */
  alert(title: string, message: string): Promise<void>;

  /** Gerenciamento de modais e diálogos imperativos */
  dialog: {
    /** Abre um modal de formulário dinâmico e retorna os dados preenchidos tipados. */
    open<TFormData extends Record<string, unknown> = Record<string, unknown>>(
      options: OpenDialogOptions
    ): Promise<TFormData | null>;

    /** Abre um modal com sub-tabela paginada para coleções relacionadas. */
    showTable(options: ShowTableOptions): Promise<void>;
  };

  /** Assistente em etapas (Wizard) */
  wizard?: {
    open<TWizardData extends Record<string, unknown> = Record<string, unknown>>(
      options: WizardOptions
    ): Promise<TWizardData | null>;
  };

  /** Notificações e Toasts temporários */
  toast: {
    success(message: string): void;
    error(message: string): void;
    warning(message: string): void;
    info(message: string): void;
  };

  /** Dispara recálculo e recarregamento automático dos dados da tela */
  refresh(): void;

  /** Utilitários de carregamento */
  loading?: {
    show(message?: string): void;
    hide(): void;
  };

  /** Atualização de barra de progresso para operações em lote */
  progress?: {
    set(percentage: number, label?: string): void;
  };

  /** Impressão formatada */
  print?: (options: { content: string }) => void;

  /** Download imediato de arquivo */
  download?: (options: { filename: string; content: string; mimeType: string }) => void;
}
