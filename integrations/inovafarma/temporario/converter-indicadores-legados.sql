-- TEMPORÁRIO: rode UMA vez no banco do cliente e depois APAGUE esta pasta (`integrations/inovafarma/temporario`)
-- e `src/colunas-desempenho-seed.ts` (mais a chamada `semearColunas` em `desempenho-routes.ts`).
--
-- Converte os Tipos de Meta (e as Apurações já fechadas) que usavam os Indicadores fixos antigos
-- (Total Foco, Vitaminas, Genéricos, Similares, Incentivos; Qtd. e Valor) para a Lista de Produtos,
-- que é a mesma coisa configurável: as entradas são os ids que estavam fixos no código (base do cliente atual).
-- Rode ANTES de subir a versão nova (o código novo não conhece mais os Indicadores antigos).
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f integrations/inovafarma/temporario/converter-indicadores-legados.sql
-- Se o script abortar, nada foi alterado: a transação é única.
BEGIN;

CREATE TEMP TABLE legado (indicador text PRIMARY KEY, unidade text NOT NULL, entradas jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO legado
SELECT c.nome || '-' || m.sufixo, m.unidade, c.entradas
FROM (VALUES
  ('vitaminas', '[{"tipo":"grupo","id":"44","nome":"VITAMINAS"}]'::jsonb),
  ('genericos', '[{"tipo":"secao","id":"261","nome":"GENERICOS"}]'::jsonb),
  ('similares', '[{"tipo":"secao","id":"271","nome":"SIMILARES"}]'::jsonb),
  ('incentivos', '[{"tipo":"secao","id":"281","nome":"INCENTIVOS"}]'::jsonb),
  ('foco', '[{"tipo":"grupo","id":"44","nome":"VITAMINAS"},{"tipo":"secao","id":"261","nome":"GENERICOS"},{"tipo":"secao","id":"271","nome":"SIMILARES"},{"tipo":"secao","id":"281","nome":"INCENTIVOS"}]'::jsonb)
) AS c(nome, entradas)
CROSS JOIN (VALUES ('qtd', 'unidades'), ('valor', 'reais')) AS m(sufixo, unidade);

-- Um Percentual que usa como base um Indicador antigo que não é o do próprio Tipo não tem como virar Lista: aborta.
DO $$
DECLARE restantes text;
BEGIN
  SELECT string_agg(t.nome || ' (base ' || (t.regra->>'indicadorBase') || ')', ', ') INTO restantes
  FROM inovafarma.tipos_meta t
  WHERE t.regra->>'tipo' = 'percentual'
    AND t.regra->>'indicadorBase' IN (SELECT indicador FROM legado)
    AND t.regra->>'indicadorBase' <> t.indicador;
  IF restantes IS NOT NULL THEN
    RAISE EXCEPTION 'Tipos de Meta com Percentual sobre outro Indicador antigo, ajuste à mão antes: %', restantes;
  END IF;
END $$;

-- Prêmio próprio dos Participantes: a base antiga vira a própria Lista.
UPDATE inovafarma.metas_participantes
SET premio = jsonb_set(premio, '{indicadorBase}', '"lista-produtos"')
WHERE premio->>'tipo' = 'percentual' AND premio->>'indicadorBase' IN (SELECT indicador FROM legado);

UPDATE inovafarma.tipos_meta t
SET lista = jsonb_build_object('entradas', l.entradas, 'unidade', l.unidade),
    regra = CASE WHEN t.regra->>'tipo' = 'percentual' AND t.regra->>'indicadorBase' = t.indicador
                 THEN jsonb_set(t.regra, '{indicadorBase}', '"lista-produtos"') ELSE t.regra END,
    indicador = 'lista-produtos',
    version = t.version + 1,
    atualizado_em = now()
FROM legado l
WHERE l.indicador = t.indicador;

-- Apurações já gravadas no fechamento: o Tipo de Meta congelado também passa a ser a Lista (o resultado em texto não muda).
UPDATE inovafarma.apuracoes_metas a
SET metas = (
  SELECT jsonb_agg(
           CASE WHEN l.indicador IS NULL THEN e.m
                ELSE jsonb_set(jsonb_set(e.m, '{tipo,indicador}', '"lista-produtos"'),
                               '{tipo,lista}', jsonb_build_object('entradas', l.entradas, 'unidade', l.unidade)) END
           ORDER BY e.ord)
  FROM jsonb_array_elements(a.metas) WITH ORDINALITY AS e(m, ord)
  LEFT JOIN legado l ON l.indicador = e.m->'tipo'->>'indicador')
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(a.metas) AS e(m) JOIN legado l ON l.indicador = e.m->'tipo'->>'indicador');

COMMIT;
