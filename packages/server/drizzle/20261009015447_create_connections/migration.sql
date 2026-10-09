CREATE TABLE "connections" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"database" text NOT NULL,
	"username" text NOT NULL,
	"password_encrypted" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
