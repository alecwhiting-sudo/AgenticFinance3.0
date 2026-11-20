CREATE SCHEMA "epm";
--> statement-breakpoint
CREATE TABLE "epm"."driver_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"label" text NOT NULL,
	"assumptions" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text DEFAULT 'seed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_set_code_version" UNIQUE("code","version")
);
--> statement-breakpoint
CREATE TABLE "epm"."plan_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"period_code" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"note" text,
	CONSTRAINT "plan_line_unique" UNIQUE("plan_version_id","account_code","period_code")
);
--> statement-breakpoint
CREATE TABLE "epm"."plan_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"driver_set_id" uuid,
	"based_on_id" uuid,
	"notes" text,
	"created_by" text DEFAULT 'seed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_by" text,
	"activated_at" timestamp with time zone,
	CONSTRAINT "plan_version_code" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "epm"."plan_line" ADD CONSTRAINT "plan_line_plan_version_id_plan_version_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "epm"."plan_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epm"."plan_version" ADD CONSTRAINT "plan_version_driver_set_id_driver_set_id_fk" FOREIGN KEY ("driver_set_id") REFERENCES "epm"."driver_set"("id") ON DELETE no action ON UPDATE no action;