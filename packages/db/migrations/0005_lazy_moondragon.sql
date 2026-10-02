CREATE TABLE "erp"."report_commentary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_code" text NOT NULL,
	"text" text NOT NULL,
	"run_id" uuid,
	"drafted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
