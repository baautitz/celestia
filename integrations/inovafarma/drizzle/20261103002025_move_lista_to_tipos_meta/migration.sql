ALTER TABLE "inovafarma"."tipos_meta" ADD COLUMN "lista" jsonb;--> statement-breakpoint
ALTER TABLE "inovafarma"."metas" DROP COLUMN "lista";--> statement-breakpoint
-- A Exibição Contagem deixou de existir: sem Alvo só mostra o Progresso; com Alvo, Atingida / Não atingida.
UPDATE "inovafarma"."tipos_meta" SET "exibicao" = CASE WHEN "sem_alvo" THEN 'progresso' ELSE 'atingida' END WHERE "exibicao" = 'contagem';
