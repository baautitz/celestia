CREATE TABLE "inovafarma"."limites_regras" (
	"id" text PRIMARY KEY,
	"nome" text NOT NULL,
	"entradas" jsonb NOT NULL,
	"fornecedores" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inovafarma"."limites_valores" (
	"id" text PRIMARY KEY,
	"regra_id" text NOT NULL,
	"inicio" text NOT NULL,
	"fim" text NOT NULL,
	"distribuicao" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "limites_regras_nome_unique" ON "inovafarma"."limites_regras" (lower("nome"));--> statement-breakpoint
CREATE INDEX "limites_valores_regra_idx" ON "inovafarma"."limites_valores" ("regra_id");--> statement-breakpoint
ALTER TABLE "inovafarma"."limites_valores" ADD CONSTRAINT "limites_valores_regra_fk" FOREIGN KEY ("regra_id") REFERENCES "inovafarma"."limites_regras"("id");