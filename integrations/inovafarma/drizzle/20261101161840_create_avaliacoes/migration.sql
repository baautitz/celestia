CREATE TABLE "inovafarma"."avaliacoes" (
	"id" text PRIMARY KEY,
	"periodo_id" text NOT NULL,
	"codigo_colaborador" integer NOT NULL,
	"nome_colaborador" text NOT NULL,
	"codigo_loja" integer NOT NULL,
	"descricao" text NOT NULL,
	"valor_centavos" integer NOT NULL,
	"criado_por" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "avaliacoes_periodo_idx" ON "inovafarma"."avaliacoes" ("periodo_id","codigo_loja");