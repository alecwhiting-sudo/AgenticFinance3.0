CREATE TABLE "agent"."extraction_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_code" text NOT NULL,
	"status" text DEFAULT 'learning' NOT NULL,
	"confirmations" integer DEFAULT 0 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"misses" integer DEFAULT 0 NOT NULL,
	"avg_model_tokens" integer DEFAULT 0 NOT NULL,
	"promoted_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_template_supplier_code_unique" UNIQUE("supplier_code")
);
