CREATE TABLE "agent"."eval_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"release_version" integer NOT NULL,
	"period_code" text NOT NULL,
	"passed" integer NOT NULL,
	"failed" integer NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."eval_summary" ADD CONSTRAINT "eval_summary_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agent"."agent"("id") ON DELETE no action ON UPDATE no action;