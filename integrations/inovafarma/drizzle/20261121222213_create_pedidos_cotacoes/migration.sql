CREATE TABLE "inovafarma"."pedidos_cotacoes" (
	"pedido_id" text,
	"codigo_fornecedor" integer,
	"precos" jsonb,
	"ordem" integer NOT NULL,
	"importado_em" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "pedidos_cotacoes_pkey" PRIMARY KEY("pedido_id","codigo_fornecedor")
);
