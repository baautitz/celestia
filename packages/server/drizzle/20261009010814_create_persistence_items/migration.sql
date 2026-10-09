CREATE TABLE "persistence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"target_foreign_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "persistence_items_lookup_idx" ON "persistence_items" ("workspace_id","collection_id","target_foreign_key");