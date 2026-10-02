CREATE SCHEMA "fdp";
--> statement-breakpoint
CREATE TYPE "fdp"."fdp_event_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "fdp"."event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at_utc" timestamp with time zone NOT NULL,
	"ingested_at_utc" timestamp with time zone DEFAULT now() NOT NULL,
	"source_system" text NOT NULL,
	"source_event_key" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deltas" jsonb,
	"status" "fdp"."fdp_event_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	CONSTRAINT "fdp_event_idempotency" UNIQUE("source_system","source_event_key")
);
--> statement-breakpoint
CREATE TABLE "fdp"."movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"account_code" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"memo" text,
	"journal_id" uuid NOT NULL,
	"engine_version" text NOT NULL,
	"processed_at_utc" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fdp"."parameter_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"parameters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fdp"."movement" ADD CONSTRAINT "movement_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "fdp"."event"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- D13 control framework: the database is part of the control framework, not
-- passive storage. Immutability + deferred double-entry enforcement.

-- Events: immutable except status/error (processing lifecycle).
CREATE OR REPLACE FUNCTION fdp.prevent_event_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fdp.event is append-only: DELETE not permitted';
  END IF;
  IF ROW(NEW.id, NEW.event_type, NEW.occurred_at_utc, NEW.ingested_at_utc,
         NEW.source_system, NEW.source_event_key, NEW.object_type,
         NEW.object_id, NEW.details, NEW.deltas)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.event_type, OLD.occurred_at_utc, OLD.ingested_at_utc,
         OLD.source_system, OLD.source_event_key, OLD.object_type,
         OLD.object_id, OLD.details, OLD.deltas) THEN
    RAISE EXCEPTION 'fdp.event is immutable: only status/error may change';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_fdp_event_immutable
  BEFORE UPDATE OR DELETE ON fdp.event
  FOR EACH ROW EXECUTE FUNCTION fdp.prevent_event_mutation();
--> statement-breakpoint
-- Movements: fully immutable.
CREATE OR REPLACE FUNCTION fdp.prevent_movement_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fdp.movement is immutable: % not permitted', TG_OP;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_fdp_movement_immutable
  BEFORE UPDATE OR DELETE ON fdp.movement
  FOR EACH ROW EXECUTE FUNCTION fdp.prevent_movement_mutation();
--> statement-breakpoint
-- Journal lines: immutable (append-only ledger, reversals not edits).
CREATE OR REPLACE FUNCTION erp.prevent_journal_line_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'erp.journal_line is immutable: % not permitted', TG_OP;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER trg_journal_line_immutable
  BEFORE UPDATE OR DELETE ON erp.journal_line
  FOR EACH ROW EXECUTE FUNCTION erp.prevent_journal_line_mutation();
--> statement-breakpoint
-- Double-entry enforced at commit: per-journal line sum must be zero
-- (debit positive, credit negative). Deferred so multi-line inserts in one
-- transaction are checked once complete.
CREATE OR REPLACE FUNCTION erp.enforce_journal_balance() RETURNS trigger AS $$
DECLARE total bigint;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0) INTO total
  FROM erp.journal_line WHERE journal_id = NEW.journal_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'journal % does not balance (sum % minor units)', NEW.journal_id, total;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_journal_balance
  AFTER INSERT ON erp.journal_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION erp.enforce_journal_balance();
--> statement-breakpoint
-- Live Economic State: derived, never written. GL view + per-object view.
CREATE VIEW fdp.les_account AS
  SELECT account_code, SUM(amount_minor)::bigint AS balance_minor
  FROM fdp.movement GROUP BY account_code;
--> statement-breakpoint
CREATE VIEW fdp.les_object AS
  SELECT object_type, object_id, account_code, SUM(amount_minor)::bigint AS balance_minor
  FROM fdp.movement GROUP BY object_type, object_id, account_code;
