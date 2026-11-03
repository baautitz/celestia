CREATE TABLE "inovafarma"."pre_vencidos_correcoes_baixa" (
	"id" text PRIMARY KEY,
	"periodo_id" text NOT NULL,
	"codigo_loja" integer NOT NULL,
	"venda_id" integer NOT NULL,
	"produto_id" text NOT NULL,
	"quantidade" integer NOT NULL,
	"motivo" text NOT NULL,
	"autor_id" text NOT NULL,
	"autor_nome" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pre_vencidos_correcoes_baixa_linha_idx" ON "inovafarma"."pre_vencidos_correcoes_baixa" ("codigo_loja","venda_id","produto_id");