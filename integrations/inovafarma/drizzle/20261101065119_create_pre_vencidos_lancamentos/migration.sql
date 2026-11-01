CREATE TABLE "inovafarma"."pre_vencidos_lancamentos" (
	"id" text PRIMARY KEY,
	"periodo_id" text NOT NULL,
	"codigo_colaborador" integer NOT NULL,
	"nome_colaborador" text NOT NULL,
	"usuario_id" text NOT NULL,
	"codigo_loja" integer NOT NULL,
	"produto_id" text NOT NULL,
	"codigo_produto" integer NOT NULL,
	"nome_produto" text NOT NULL,
	"codigo_barra" text,
	"quantidade" integer NOT NULL,
	"validade" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pre_vencidos_lancamentos_periodo_idx" ON "inovafarma"."pre_vencidos_lancamentos" ("periodo_id","codigo_colaborador");