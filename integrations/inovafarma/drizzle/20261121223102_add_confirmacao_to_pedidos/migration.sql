ALTER TABLE "inovafarma"."pedidos" ADD COLUMN "escolhas" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "inovafarma"."pedidos" ADD COLUMN "confirmado_em" timestamp;