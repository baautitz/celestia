ALTER TABLE "closing_period"."periods" ALTER COLUMN "start_date" SET DATA TYPE date USING "start_date"::date;--> statement-breakpoint
ALTER TABLE "closing_period"."periods" ALTER COLUMN "end_date" SET DATA TYPE date USING "end_date"::date;
--> statement-breakpoint
-- Uma data pertence a no máximo um período (faixas inclusivas). Faz valer a regra mesmo com requisições concorrentes,
-- onde "consultar e inserir" não é atômico. O índice GiST sobre daterange dispensa a extensão btree_gist.
ALTER TABLE "closing_period"."periods" ADD CONSTRAINT "periods_no_overlap" EXCLUDE USING gist (daterange("start_date", "end_date", '[]') WITH &&);
