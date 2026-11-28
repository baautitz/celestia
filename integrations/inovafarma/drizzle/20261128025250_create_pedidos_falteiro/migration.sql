CREATE TABLE "inovafarma"."pedidos_falteiro" (
	"id" text PRIMARY KEY,
	"produto_id" text NOT NULL,
	"codigo_loja" integer,
	"quantidade" integer,
	"observacao" text,
	"criado_por_id" text NOT NULL,
	"criado_por_nome" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pedidos_falteiro_produto_loja_unique" UNIQUE NULLS NOT DISTINCT("produto_id","codigo_loja")
);
