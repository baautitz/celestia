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
