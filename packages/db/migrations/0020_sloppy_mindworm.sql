CREATE TABLE "evidence"."mail_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"to_addr" text NOT NULL,
	"from_addr" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"case_id" uuid,
	"invoice_id" uuid,
	"invoice_number" text,
	"counterparty" text,
	"option_label" text,
	"created_by" text NOT NULL,
	"edited_by" text,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence"."mail_message" ADD CONSTRAINT "mail_message_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "evidence"."case"("id") ON DELETE no action ON UPDATE no action;