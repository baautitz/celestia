CREATE TABLE "inovafarma"."pre_vencidos_baixas_congeladas" (
	"periodo_id" text,
	"codigo_loja" integer,
	"ate" text NOT NULL,
	"baixas" jsonb NOT NULL,
	"itens" jsonb NOT NULL,
	"congelado_em" timestamp NOT NULL,
	CONSTRAINT "pre_vencidos_baixas_congeladas_pkey" PRIMARY KEY("periodo_id","codigo_loja")
);
--> statement-breakpoint
CREATE INDEX "pre_vencidos_baixas_congeladas_loja_idx" ON "inovafarma"."pre_vencidos_baixas_congeladas" ("codigo_loja","ate");