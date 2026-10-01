CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "erp";
--> statement-breakpoint
CREATE TYPE "erp"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "core"."period_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "erp"."account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "erp"."account_type" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "account_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "core"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"object_type" text,
	"object_id" text,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "core"."company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "erp"."customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"payment_terms_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "core"."fiscal_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "core"."period_status" DEFAULT 'open' NOT NULL,
	CONSTRAINT "fiscal_period_company_code" UNIQUE("company_id","code")
);
--> statement-breakpoint
CREATE TABLE "erp"."item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"unit_price_minor" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "item_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "erp"."supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"payment_terms_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "erp"."account" ADD CONSTRAINT "account_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp"."customer" ADD CONSTRAINT "customer_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."fiscal_period" ADD CONSTRAINT "fiscal_period_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp"."item" ADD CONSTRAINT "item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp"."supplier" ADD CONSTRAINT "supplier_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."company"("id") ON DELETE no action ON UPDATE no action;