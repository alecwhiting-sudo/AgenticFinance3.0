CREATE TABLE "agent"."shadow_replay" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"draft_release_id" uuid NOT NULL,
	"baseline_release_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"cases" integer DEFAULT 0 NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb,
	"created_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent"."shadow_replay" ADD CONSTRAINT "shadow_replay_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agent"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."shadow_replay" ADD CONSTRAINT "shadow_replay_draft_release_id_agent_release_id_fk" FOREIGN KEY ("draft_release_id") REFERENCES "agent"."agent_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."shadow_replay" ADD CONSTRAINT "shadow_replay_baseline_release_id_agent_release_id_fk" FOREIGN KEY ("baseline_release_id") REFERENCES "agent"."agent_release"("id") ON DELETE no action ON UPDATE no action;