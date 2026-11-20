CREATE TABLE "iam"."sessions" (
	"token_hash" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"user_session_version" integer NOT NULL,
	"device_id" text,
	"family_id" text NOT NULL,
	"issued_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint
);
--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "iam"."sessions" ("family_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "iam"."sessions" ("expires_at");--> statement-breakpoint
ALTER TABLE "iam"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE;