CREATE SCHEMA IF NOT EXISTS "inovafarma";
--> statement-breakpoint
CREATE TABLE "inovafarma"."vinculos_colaborador" (
	"codigo_colaborador" integer PRIMARY KEY,
	"usuario_id" text CONSTRAINT "vinculos_colaborador_usuario_id_unique" UNIQUE,
	"version" integer DEFAULT 1 NOT NULL,
	"atualizado_por" text NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
