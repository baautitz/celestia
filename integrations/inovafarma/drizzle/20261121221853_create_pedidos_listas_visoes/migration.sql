CREATE TABLE "inovafarma"."pedidos_listas" (
	"id" text PRIMARY KEY,
	"nome" text NOT NULL,
	"entradas" jsonb DEFAULT '[]' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inovafarma"."pedidos_visoes" (
	"id" text PRIMARY KEY,
	"usuario_id" text NOT NULL,
	"nome" text NOT NULL,
	"lojas" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"listas" jsonb DEFAULT '[]' NOT NULL,
	"laboratorio" text,
	"grupo" text,
	"secao" text,
	"apenas_com_minimo" boolean DEFAULT false NOT NULL,
	"padrao" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pedidos_listas_nome_unique" ON "inovafarma"."pedidos_listas" (lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "pedidos_visoes_usuario_nome_unique" ON "inovafarma"."pedidos_visoes" ("usuario_id",lower("nome"));--> statement-breakpoint
CREATE UNIQUE INDEX "pedidos_visoes_usuario_padrao_unique" ON "inovafarma"."pedidos_visoes" ("usuario_id") WHERE "padrao";