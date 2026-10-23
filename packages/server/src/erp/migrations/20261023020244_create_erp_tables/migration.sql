CREATE SCHEMA IF NOT EXISTS "erp";
--> statement-breakpoint
CREATE TABLE "erp"."erps" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"driver" text NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"secrets_encrypted" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp"."user_externals" (
	"user_id" text,
	"erp_id" text,
	"values" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_externals_pkey" PRIMARY KEY("user_id","erp_id")
);
--> statement-breakpoint
ALTER TABLE "erp"."user_externals" ADD CONSTRAINT "user_externals_erp_id_erps_id_fkey" FOREIGN KEY ("erp_id") REFERENCES "erp"."erps"("id") ON DELETE CASCADE;
