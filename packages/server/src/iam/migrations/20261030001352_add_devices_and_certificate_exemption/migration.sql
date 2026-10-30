CREATE TABLE "iam"."devices" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"fingerprint" text NOT NULL UNIQUE,
	"serial" text NOT NULL,
	"not_after" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"revoked_at" timestamp,
	"revoked_by" text
);
--> statement-breakpoint
ALTER TABLE "iam"."users" ADD COLUMN "allow_without_certificate" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Administrators que já existem seguem entrando só com a senha: ainda não têm Dispositivo para emitir o primeiro.
UPDATE "iam"."users" SET "allow_without_certificate" = true WHERE "is_admin" = true;
