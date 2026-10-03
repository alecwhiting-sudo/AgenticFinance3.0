CREATE TABLE "agent"."agent_skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"added_by" text DEFAULT 'seed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_skill_unique" UNIQUE("agent_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "agent"."agent_skill" ADD CONSTRAINT "agent_skill_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agent"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_skill" ADD CONSTRAINT "agent_skill_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "agent"."skill"("id") ON DELETE no action ON UPDATE no action;