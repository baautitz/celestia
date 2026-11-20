CREATE TABLE "inovafarma"."colunas_desempenho" (
	"id" text PRIMARY KEY,
	"nome" text NOT NULL,
	"ordem" integer NOT NULL,
	"entradas" jsonb DEFAULT '[]' NOT NULL,
	"uniao" jsonb DEFAULT '[]' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "colunas_desempenho_nome_unique" ON "inovafarma"."colunas_desempenho" (lower("nome"));