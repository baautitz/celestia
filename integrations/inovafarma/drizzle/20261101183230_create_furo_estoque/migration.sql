CREATE TABLE "inovafarma"."justificativas_ajuste" (
	"id" text PRIMARY KEY,
	"periodo_id" text NOT NULL,
	"codigo_movimento" integer NOT NULL CONSTRAINT "justificativas_ajuste_codigo_movimento_unique" UNIQUE,
	"codigo_loja" integer NOT NULL,
	"motivo_id" text NOT NULL,
	"observacao" text,
	"criado_por" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inovafarma"."motivos_ajuste" (
	"id" text PRIMARY KEY,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "justificativas_ajuste_periodo_idx" ON "inovafarma"."justificativas_ajuste" ("periodo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "motivos_ajuste_nome_unique" ON "inovafarma"."motivos_ajuste" (lower("nome"));--> statement-breakpoint
ALTER TABLE "inovafarma"."justificativas_ajuste" ADD CONSTRAINT "justificativas_ajuste_motivo_id_motivos_ajuste_id_fkey" FOREIGN KEY ("motivo_id") REFERENCES "inovafarma"."motivos_ajuste"("id");--> statement-breakpoint
INSERT INTO "inovafarma"."motivos_ajuste" ("id", "nome") VALUES
	('mot_vencido', 'Vencido'),
	('mot_avaria', 'Avaria / Quebra'),
	('mot_erro_contagem', 'Erro de contagem'),
	('mot_uso_interno', 'Uso interno'),
	('mot_fracionamento', 'Fracionamento / Kit'),
	('mot_troca', 'Troca'),
	('mot_outros', 'Outros');
