CREATE TYPE "erp"."ar_invoice_status" AS ENUM('issued', 'posted', 'paid');--> statement-breakpoint
CREATE TABLE "erp"."ar_dunning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"text" text NOT NULL,
	"sent_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp"."ar_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"lines" jsonb NOT NULL,
	"net_minor" integer NOT NULL,
	"vat_minor" integer NOT NULL,
	"gross_minor" integer NOT NULL,
	"status" "erp"."ar_invoice_status" DEFAULT 'issued' NOT NULL,
	"document_path" text,
	"contract_path" text,
	"remittance_path" text,
	"journal_id" uuid,
	"receipt_journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ar_invoice_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "erp"."ar_dunning" ADD CONSTRAINT "ar_dunning_invoice_id_ar_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "erp"."ar_invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp"."ar_invoice" ADD CONSTRAINT "ar_invoice_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "erp"."customer"("id") ON DELETE no action ON UPDATE no action;