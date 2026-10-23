CREATE SCHEMA IF NOT EXISTS "closing_period";
--> statement-breakpoint
CREATE TABLE "closing_period"."periods" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
