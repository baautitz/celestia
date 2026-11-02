CREATE TABLE "inovafarma"."apuracoes_metas" (
	"periodo_id" text PRIMARY KEY,
	"metas" jsonb NOT NULL,
	"apurado_em" timestamp NOT NULL
);
