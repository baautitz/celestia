ALTER TABLE "inovafarma"."tipos_meta" ADD COLUMN "lista" jsonb;--> statement-breakpoint
ALTER TABLE "inovafarma"."metas" DROP COLUMN "lista";