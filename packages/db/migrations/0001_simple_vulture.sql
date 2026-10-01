CREATE SCHEMA "agent";
--> statement-breakpoint
CREATE SCHEMA "evidence";
--> statement-breakpoint
CREATE TYPE "agent"."agent_status" AS ENUM('active', 'paused', 'retired');--> statement-breakpoint
CREATE TYPE "evidence"."case_status" AS ENUM('open', 'waiting_approval', 'resolved', 'escalated');--> statement-breakpoint
CREATE TYPE "agent"."command_status" AS ENUM('proposed', 'approved', 'rejected', 'executed', 'failed');--> statement-breakpoint
CREATE TYPE "agent"."eval_run_status" AS ENUM('running', 'passed', 'failed');--> statement-breakpoint
CREATE TYPE "agent"."release_status" AS ENUM('draft', 'evaluated', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "agent"."run_outcome" AS ENUM('completed', 'escalated', 'failed', 'abstained');--> statement-breakpoint
CREATE TYPE "agent"."work_item_status" AS ENUM('pending', 'claimed', 'running', 'completed', 'escalated', 'failed');--> statement-breakpoint
CREATE TABLE "agent"."activity_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"seq" bigserial NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"verb" text NOT NULL,
	"object_type" text,
	"object_id" text,
	"case_id" uuid,
	"summary" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent"."agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"owner" text NOT NULL,
	"status" "agent"."agent_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agent"."agent_release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"instructions" text NOT NULL,
	"skill_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"command_permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_profile" text DEFAULT 'default' NOT NULL,
	"max_model_calls" integer DEFAULT 10 NOT NULL,
	"max_cost_minor" integer DEFAULT 100 NOT NULL,
	"status" "agent"."release_status" DEFAULT 'draft' NOT NULL,
	"eval_run_id" uuid,
	"notes" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_by" text,
	"promoted_at" timestamp with time zone,
	CONSTRAINT "agent_release_unique" UNIQUE("agent_id","version")
);
--> statement-breakpoint
CREATE TABLE "agent"."agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"work_item_id" uuid,
	"eval_case_id" uuid,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"outcome" "agent"."run_outcome",
	"result_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evidence"."case_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent"."command" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"params" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"run_id" uuid,
	"agent_id" uuid,
	"release_id" uuid,
	"status" "agent"."command_status" DEFAULT 'proposed' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"decided_by" text,
	"decision_reason" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "command_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "evidence"."document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"mime" text NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"case_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent"."eval_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"input" jsonb NOT NULL,
	"assertions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent"."eval_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"status" "agent"."eval_run_status" DEFAULT 'running' NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evidence"."case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"status" "evidence"."case_status" DEFAULT 'open' NOT NULL,
	"owner_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent"."skill" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agent"."skill_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"instructions" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_version_unique" UNIQUE("skill_id","version")
);
--> statement-breakpoint
CREATE TABLE "agent"."work_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"agent_id" uuid,
	"case_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "agent"."work_item_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent"."agent_release" ADD CONSTRAINT "agent_release_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agent"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_run" ADD CONSTRAINT "agent_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agent"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_run" ADD CONSTRAINT "agent_run_release_id_agent_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "agent"."agent_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_run" ADD CONSTRAINT "agent_run_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "agent"."work_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."case_event" ADD CONSTRAINT "case_event_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "evidence"."case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."command" ADD CONSTRAINT "command_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "agent"."agent_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."command" ADD CONSTRAINT "command_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agent"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."command" ADD CONSTRAINT "command_release_id_agent_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "agent"."agent_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."document" ADD CONSTRAINT "document_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "evidence"."case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."eval_case" ADD CONSTRAINT "eval_case_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agent"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."eval_run" ADD CONSTRAINT "eval_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agent"."agent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."eval_run" ADD CONSTRAINT "eval_run_release_id_agent_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "agent"."agent_release"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."skill_version" ADD CONSTRAINT "skill_version_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "agent"."skill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."work_item" ADD CONSTRAINT "work_item_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agent"."agent"("id") ON DELETE no action ON UPDATE no action;