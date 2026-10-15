DROP TABLE "persistence_items";--> statement-breakpoint
DROP TABLE "recipes";--> statement-breakpoint
ALTER TABLE "workspaces" DROP COLUMN "recipe_id";--> statement-breakpoint
ALTER TABLE "workspaces" DROP COLUMN "params";