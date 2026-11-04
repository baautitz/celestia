CREATE TABLE "iam"."user_preferences" (
	"user_id" text,
	"key" text,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_pkey" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "iam"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE;