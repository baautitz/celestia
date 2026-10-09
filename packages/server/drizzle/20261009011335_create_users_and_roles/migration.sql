CREATE TABLE "roles" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY,
	"fullname" text NOT NULL,
	"username" text NOT NULL UNIQUE,
	"email" text,
	"password_hash" text NOT NULL,
	"role_id" text NOT NULL,
	"externals" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id");