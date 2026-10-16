CREATE TABLE "agent"."release_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"shadow_replay_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"verdict" text,
	"grounded" boolean DEFAULT false NOT NULL,
	"body" jsonb,
	"facts" jsonb,
	"run_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent"."release_review" ADD CONSTRAINT "release_review_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agent"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."release_review" ADD CONSTRAINT "release_review_release_id_agent_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "agent"."agent_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."release_review" ADD CONSTRAINT "release_review_shadow_replay_id_shadow_replay_id_fk" FOREIGN KEY ("shadow_replay_id") REFERENCES "agent"."shadow_replay"("id") ON DELETE no action ON UPDATE no action;