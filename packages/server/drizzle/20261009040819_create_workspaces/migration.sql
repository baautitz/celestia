CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY,
	"recipe_id" text NOT NULL,
	"name" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"params" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
