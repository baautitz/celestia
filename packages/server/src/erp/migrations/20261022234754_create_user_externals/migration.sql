CREATE TABLE "erp"."user_externals" (
	"user_id" text,
	"erp_id" text,
	"values" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_externals_pkey" PRIMARY KEY("user_id","erp_id")
);
--> statement-breakpoint
ALTER TABLE "erp"."user_externals" ADD CONSTRAINT "user_externals_erp_id_erps_id_fkey" FOREIGN KEY ("erp_id") REFERENCES "erp"."erps"("id") ON DELETE CASCADE;