CREATE TABLE "recipes" (
	"id" text PRIMARY KEY,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
