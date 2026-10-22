CREATE TABLE "audit_log_entries" (
	"id" text PRIMARY KEY,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"plugin" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"attributes" jsonb DEFAULT '{}' NOT NULL,
	"schema_version" integer NOT NULL,
	"summary" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log_entries" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_occurred_idx" ON "audit_log_entries" ("occurred_at");
--> statement-breakpoint
CREATE FUNCTION "audit_log_entries_append_only"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit_log_entries é somente acréscimo'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_log_entries_no_change" BEFORE UPDATE OR DELETE ON "audit_log_entries" FOR EACH ROW EXECUTE FUNCTION "audit_log_entries_append_only"();
