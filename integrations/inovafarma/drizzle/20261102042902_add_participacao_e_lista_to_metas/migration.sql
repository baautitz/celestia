ALTER TABLE "inovafarma"."metas" ADD COLUMN "excluidos" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "inovafarma"."metas" ADD COLUMN "lista" jsonb;