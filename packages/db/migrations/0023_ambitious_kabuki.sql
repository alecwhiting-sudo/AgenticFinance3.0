ALTER TYPE "core"."period_status" ADD VALUE 'locked';--> statement-breakpoint
ALTER TYPE "core"."period_status" ADD VALUE 'certified';--> statement-breakpoint
CREATE TABLE "fdp"."lrs_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'locked' NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked_by" text NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"certified_by" text,
	"certified_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"superseded_reason" text,
	CONSTRAINT "lrs_snapshot_period_version" UNIQUE("period_code","version")
);
--> statement-breakpoint
CREATE TABLE "fdp"."lrs_snapshot_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"movement_minor" bigint NOT NULL,
	"closing_minor" bigint NOT NULL,
	CONSTRAINT "lrs_snapshot_line_unique" UNIQUE("snapshot_id","account_code")
);
--> statement-breakpoint
ALTER TABLE "fdp"."lrs_snapshot_line" ADD CONSTRAINT "lrs_snapshot_line_snapshot_id_lrs_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "fdp"."lrs_snapshot"("id") ON DELETE no action ON UPDATE no action;