CREATE TABLE "inovafarma"."pre_vencidos_itens" (
	"id" text PRIMARY KEY,
	"codigo_loja" integer NOT NULL,
	"produto_id" text NOT NULL,
	"codigo_produto" integer NOT NULL,
	"nome_produto" text NOT NULL,
	"codigo_barra" text,
	"validade" text NOT NULL,
	"quantidade" integer NOT NULL,
	"incluido_em" timestamp NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pre_vencidos_itens_loja_idx" ON "inovafarma"."pre_vencidos_itens" ("codigo_loja","incluido_em");