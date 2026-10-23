CREATE SCHEMA IF NOT EXISTS "iam";
--> statement-breakpoint
CREATE TABLE "iam"."roles" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam"."users" (
	"id" text PRIMARY KEY,
	"fullname" text NOT NULL,
	"username" text NOT NULL UNIQUE,
	"email" text,
	"password_hash" text NOT NULL,
	"role_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "iam"."users" ADD CONSTRAINT "users_role_id_roles_id_fkey" FOREIGN KEY ("role_id") REFERENCES "iam"."roles"("id");
--> statement-breakpoint
INSERT INTO "iam"."roles" ("id", "name", "description", "permissions") VALUES
	(
		'gestor',
		'Gestor',
		'Gestão de usuários, perfis, ERPs, períodos de fechamento e consulta de auditoria.',
		'["system:users:create","system:users:read","system:users:update","system:users:reset_password","system:users:delete","system:roles:create","system:roles:read","system:roles:update","system:erps:manage","system:audit:read","closing_period:period:read","closing_period:period:update","closing_period:period:create","closing_period:period:close","closing_period:period:reopen","closing_period:period:cancel"]'::jsonb
	),
	(
		'operador',
		'Operador',
		'Operação de períodos de fechamento.',
		'["closing_period:period:read","closing_period:period:create","closing_period:period:update","closing_period:period:close"]'::jsonb
	)
ON CONFLICT ("id") DO NOTHING;
