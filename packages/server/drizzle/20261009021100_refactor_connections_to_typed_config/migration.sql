ALTER TABLE "connections" ADD COLUMN "config" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "secrets_encrypted" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "host";--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "port";--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "database";--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "username";--> statement-breakpoint
ALTER TABLE "connections" DROP COLUMN "password_encrypted";