CREATE TABLE "inovafarma"."pedidos_minimos" (
	"produto_id" text,
	"codigo_loja" integer,
	"minimo" double precision NOT NULL,
	"maximo" double precision,
	"version" integer DEFAULT 1 NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pedidos_minimos_pkey" PRIMARY KEY("produto_id","codigo_loja")
);
