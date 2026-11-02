CREATE TABLE "inovafarma"."metas" (
	"id" text PRIMARY KEY,
	"periodo_id" text NOT NULL,
	"tipo_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inovafarma"."metas_participantes" (
	"meta_id" text,
	"codigo_colaborador" integer,
	"nome" text NOT NULL,
	"alvo" double precision,
	CONSTRAINT "metas_participantes_pkey" PRIMARY KEY("meta_id","codigo_colaborador")
);
--> statement-breakpoint
CREATE TABLE "inovafarma"."tipos_meta" (
	"id" text PRIMARY KEY,
	"nome" text NOT NULL,
	"indicador" text NOT NULL,
	"exibicao" text NOT NULL,
	"mostrar_premio" boolean NOT NULL,
	"sem_alvo" boolean NOT NULL,
	"regra" jsonb NOT NULL,
	"alvo_padrao" double precision,
	"ativo" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "metas_periodo_tipo_unique" ON "inovafarma"."metas" ("periodo_id","tipo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tipos_meta_nome_unique" ON "inovafarma"."tipos_meta" (lower("nome"));--> statement-breakpoint
ALTER TABLE "inovafarma"."metas" ADD CONSTRAINT "metas_tipo_id_tipos_meta_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "inovafarma"."tipos_meta"("id");--> statement-breakpoint
ALTER TABLE "inovafarma"."metas_participantes" ADD CONSTRAINT "metas_participantes_meta_id_metas_id_fkey" FOREIGN KEY ("meta_id") REFERENCES "inovafarma"."metas"("id") ON DELETE CASCADE;