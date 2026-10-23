CREATE TABLE "example"."notes" (
	"id" text PRIMARY KEY,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
