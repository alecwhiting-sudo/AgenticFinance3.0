CREATE TYPE "erp"."ap_invoice_status" AS ENUM('captured', 'matched', 'exception', 'approved', 'posted', 'scheduled', 'paid', 'rejected');--> statement-breakpoint
CREATE TYPE "erp"."ap_payment_status" AS ENUM('proposed', 'approved', 'executed', 'reconciled', 'rejected');--> statement-breakpoint
CREATE TYPE "erp"."approval_band" AS ENUM('auto', 'standard', 'director');--> statement-breakpoint
CREATE TYPE "erp"."bank_txn_status" AS ENUM('unmatched', 'matched');--> statement-breakpoint
CREATE TYPE "erp"."journal_status" AS ENUM('draft', 'posted', 'reversed');--> statement-breakpoint
CREATE TYPE "erp"."purchase_status" AS ENUM('requested', 'approved', 'partially_received', 'received', 'closed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "erp"."ap_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_invoice_number" text NOT NULL,
	"purchase_id" uuid,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"lines" jsonb NOT NULL,
	"net_minor" integer NOT NULL,
	"vat_minor" integer NOT NULL,
	"gross_minor" integer NOT NULL,
	"status" "erp"."ap_invoice_status" DEFAULT 'captured' NOT NULL,
	"exception_code" text,
	"case_id" uuid,
	"document_path" text,
	"email_path" text,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_invoice_supplier_number" UNIQUE("supplier_id","supplier_invoice_number")
);
--> statement-breakpoint
CREATE TABLE "erp"."ap_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_ref" text NOT NULL,
	"run_date" date NOT NULL,
	"invoice_ids" jsonb NOT NULL,
	"total_minor" integer NOT NULL,
	"status" "erp"."ap_payment_status" DEFAULT 'proposed' NOT NULL,
	"executed_at" timestamp with time zone,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_payment_payment_ref_unique" UNIQUE("payment_ref")
);
--> statement-breakpoint
CREATE TABLE "erp"."bank_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"txn_date" date NOT NULL,
	"amount_minor" integer NOT NULL,
	"reference" text NOT NULL,
	"counterparty" text NOT NULL,
	"kind" text NOT NULL,
	"status" "erp"."bank_txn_status" DEFAULT 'unmatched' NOT NULL,
	"matched_type" text,
	"matched_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erp"."category_budget" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_code" text NOT NULL,
	"period_code" text NOT NULL,
	"budget_minor" integer NOT NULL,
	"committed_minor" integer DEFAULT 0 NOT NULL,
	"actual_minor" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "category_budget_unique" UNIQUE("account_code","period_code")
);
--> statement-breakpoint
CREATE TABLE "erp"."goods_receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"purchase_id" uuid NOT NULL,
	"receipt_date" date NOT NULL,
	"quantities" jsonb NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipt_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "erp"."journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"journal_date" date NOT NULL,
	"period_code" text NOT NULL,
	"memo" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"status" "erp"."journal_status" DEFAULT 'posted' NOT NULL,
	"reverses_journal_id" uuid,
	"posted_by" text NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_number_unique" UNIQUE("number"),
	CONSTRAINT "journal_source_unique" UNIQUE("source_type","source_id")
);
--> statement-breakpoint
CREATE TABLE "erp"."journal_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_code" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "erp"."purchase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"business_need" text NOT NULL,
	"request_date" date NOT NULL,
	"approval_band" "erp"."approval_band",
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"order_date" date,
	"lines" jsonb NOT NULL,
	"total_minor" integer NOT NULL,
	"status" "erp"."purchase_status" DEFAULT 'requested' NOT NULL,
	"document_path" text,
	"case_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "erp"."ap_invoice" ADD CONSTRAINT "ap_invoice_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "erp"."supplier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp"."ap_invoice" ADD CONSTRAINT "ap_invoice_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "erp"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp"."goods_receipt" ADD CONSTRAINT "goods_receipt_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "erp"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp"."journal" ADD CONSTRAINT "journal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp"."journal_line" ADD CONSTRAINT "journal_line_journal_id_journal_id_fk" FOREIGN KEY ("journal_id") REFERENCES "erp"."journal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp"."purchase" ADD CONSTRAINT "purchase_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "erp"."supplier"("id") ON DELETE no action ON UPDATE no action;