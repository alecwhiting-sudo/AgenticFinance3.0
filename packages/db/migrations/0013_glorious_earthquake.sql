ALTER TABLE "erp"."ap_invoice" ADD COLUMN "book" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent"."command" ADD COLUMN "book" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "fdp"."event" ADD COLUMN "book" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "erp"."journal" ADD COLUMN "book" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "erp"."purchase" ADD COLUMN "book" text DEFAULT 'main' NOT NULL;