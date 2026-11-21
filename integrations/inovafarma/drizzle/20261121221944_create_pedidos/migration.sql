CREATE TABLE "inovafarma"."pedidos" (
	"id" text PRIMARY KEY,
	"status" text NOT NULL,
	"itens" jsonb NOT NULL,
	"criado_por_id" text NOT NULL,
	"criado_por_nome" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pedidos_status_idx" ON "inovafarma"."pedidos" ("status","criado_em");