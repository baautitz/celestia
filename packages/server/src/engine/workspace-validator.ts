import { z } from "zod";

/**
 * Validador Zod para o intervalo de datas obrigatório de toda Área de Trabalho (Workspace).
 * Garante formato AAAA-MM-DD e impede que a data final seja anterior à data inicial.
 */
export const WorkspaceDatesSchema = z
  .object({
    start_date: z
      .string({ required_error: "A Data Inicial é obrigatória para a Área de Trabalho." })
      .regex(/^\d{4}-\d{2}-\d{2}/, "A Data Inicial deve ser uma data válida no formato AAAA-MM-DD."),
    end_date: z
      .string({ required_error: "A Data Final é obrigatória para a Área de Trabalho." })
      .regex(/^\d{4}-\d{2}-\d{2}/, "A Data Final deve ser uma data válida no formato AAAA-MM-DD."),
  })
  .refine(
    (data) => {
      const start = new Date(data.start_date);
      const end = new Date(data.end_date);
      return end.getTime() >= start.getTime();
    },
    {
      message: "A Data Final não pode ser anterior à Data Inicial.",
      path: ["end_date"],
    }
  );

export class WorkspaceValidator {
  /**
   * Valida estritamente as datas de uma Área de Trabalho.
   * Lança erro com mensagem em PT-BR caso a regra de negócio seja violada.
   */
  static validateDates(startDate?: string, endDate?: string): { startDate: string; endDate: string } {
    if (!startDate) {
      throw new Error("A Data Inicial é obrigatória para a Área de Trabalho.");
    }
    if (!endDate) {
      throw new Error("A Data Final é obrigatória para a Área de Trabalho.");
    }

    const result = WorkspaceDatesSchema.safeParse({
      start_date: startDate,
      end_date: endDate,
    });

    if (!result.success) {
      const errorMessage = result.error.errors[0]?.message || "Intervalo de datas inválido.";
      throw new Error(errorMessage);
    }

    return {
      startDate: result.data.start_date,
      endDate: result.data.end_date,
    };
  }
}
