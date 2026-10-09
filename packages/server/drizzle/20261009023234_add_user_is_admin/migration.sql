ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "users" SET "is_admin" = true WHERE "role_id" = 'role_admin';
