ALTER TABLE "inovafarma"."pedidos_visoes" ADD COLUMN "entradas" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Converte o Laboratório, o Grupo e a Seção já salvos em entradas. O nome antigo não foi guardado (só o código do ERP):
-- a entrada leva um nome provisório com o código, que a janela do filtro mostra até a visão ser salva de novo.
UPDATE "inovafarma"."pedidos_visoes" SET "entradas" = (
	SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) FROM (
		SELECT jsonb_build_object('tipo', 'laboratorio', 'id', "laboratorio", 'nome', 'Laboratório ' || "laboratorio") AS e WHERE "laboratorio" IS NOT NULL
		UNION ALL
		SELECT jsonb_build_object('tipo', 'grupo', 'id', "grupo", 'nome', 'Grupo ' || "grupo") WHERE "grupo" IS NOT NULL
		UNION ALL
		SELECT jsonb_build_object('tipo', 'secao', 'id', "secao", 'nome', 'Seção ' || "secao") WHERE "secao" IS NOT NULL
	) x
);--> statement-breakpoint
ALTER TABLE "inovafarma"."pedidos_visoes" DROP COLUMN "laboratorio";--> statement-breakpoint
ALTER TABLE "inovafarma"."pedidos_visoes" DROP COLUMN "grupo";--> statement-breakpoint
ALTER TABLE "inovafarma"."pedidos_visoes" DROP COLUMN "secao";