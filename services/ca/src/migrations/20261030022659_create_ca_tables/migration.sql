CREATE SCHEMA IF NOT EXISTS "ca";
--> statement-breakpoint
CREATE TABLE "ca"."devices" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"fingerprint" text NOT NULL UNIQUE,
	"serial" text NOT NULL,
	"not_after" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"revoked_at" timestamp,
	"revoked_by" text
);
