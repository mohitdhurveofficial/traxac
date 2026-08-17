CREATE TABLE "payment_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gstin_id" uuid,
	"name" text NOT NULL,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_settings" (
	"gstin_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tcs_enabled" boolean DEFAULT false NOT NULL,
	"tcs_rate" text DEFAULT '0.1' NOT NULL,
	"tcs_section" text DEFAULT '206C(1H)' NOT NULL,
	"round_off_enabled" boolean DEFAULT true NOT NULL,
	"igst_on_intra_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gstin_id" uuid NOT NULL,
	"return_type" text DEFAULT 'gstr1' NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"filing_status" text DEFAULT 'not_connected' NOT NULL,
	"invoice_count" text DEFAULT '0' NOT NULL,
	"total_taxable_value" bigint DEFAULT 0 NOT NULL,
	"total_tax" bigint DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"validation_errors" jsonb,
	"generated_at" timestamp with time zone,
	"generated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"invoice_id" uuid,
	"match_status" text NOT NULL,
	"differences" jsonb,
	"document_number" text,
	"document_date" timestamp with time zone,
	"counterparty_gstin" text,
	"our_value" bigint DEFAULT 0 NOT NULL,
	"their_value" bigint DEFAULT 0 NOT NULL,
	"irn" text,
	"ewb_number" text,
	"external_payload" jsonb,
	"error_detail" text,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gstin_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'portal' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"matched" text DEFAULT '0' NOT NULL,
	"mismatched" text DEFAULT '0' NOT NULL,
	"missing_locally" text DEFAULT '0' NOT NULL,
	"missing_remotely" text DEFAULT '0' NOT NULL,
	"last_error" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "gstin_id" uuid;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "payment_terms_id" uuid;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "opening_balance" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "gstin_id" uuid;--> statement-breakpoint
ALTER TABLE "transporters" ADD COLUMN "gstin_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "gstin_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "insurance_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tcs_rate" numeric(5, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tcs_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tcs_section" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "delivery_note_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "delivery_note_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_terms_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_terms_label" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "credit_days" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "generated_by" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "download_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "last_downloaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_settings" ADD CONSTRAINT "tax_settings_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_settings" ADD CONSTRAINT "tax_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_returns" ADD CONSTRAINT "gst_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_returns" ADD CONSTRAINT "gst_returns_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."reconciliation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_terms_tenant_idx" ON "payment_terms" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_terms_tenant_name_uq" ON "payment_terms" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "gst_returns_tenant_idx" ON "gst_returns" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_returns_uq" ON "gst_returns" USING btree ("tenant_id","gstin_id","return_type","period");--> statement-breakpoint
CREATE INDEX "reconciliation_items_run_idx" ON "reconciliation_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "reconciliation_items_tenant_idx" ON "reconciliation_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "reconciliation_items_status_idx" ON "reconciliation_items" USING btree ("tenant_id","match_status");--> statement-breakpoint
CREATE INDEX "reconciliation_items_invoice_idx" ON "reconciliation_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_tenant_idx" ON "reconciliation_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_runs_uq" ON "reconciliation_runs" USING btree ("tenant_id","gstin_id","scope","period");--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transporters" ADD CONSTRAINT "transporters_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parties_tenant_registration_idx" ON "parties" USING btree ("tenant_id","gstin_id");--> statement-breakpoint
CREATE INDEX "products_tenant_gstin_idx" ON "products" USING btree ("tenant_id","gstin_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_gstin_date_idx" ON "invoices" USING btree ("tenant_id","gstin_id","invoice_date");--> statement-breakpoint
CREATE INDEX "invoices_tenant_due_idx" ON "invoices" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "invoices_tenant_number_idx" ON "invoices" USING btree ("tenant_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_reference_idx" ON "invoices" USING btree ("reference_invoice_id");