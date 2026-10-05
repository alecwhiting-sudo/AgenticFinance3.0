CREATE TABLE "core"."board_pack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book" text DEFAULT 'main' NOT NULL,
	"lens_grain" text NOT NULL,
	"period_from" text NOT NULL,
	"period_to" text NOT NULL,
	"label" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'drafting' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work_item_id" uuid,
	"created_by" text DEFAULT 'workbench-user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
