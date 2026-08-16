CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"default_gstin_id" uuid,
	"auto_generate_einvoice" boolean DEFAULT true NOT NULL,
	"auto_generate_ewb" boolean DEFAULT false NOT NULL,
	"ewb_threshold" jsonb DEFAULT '{"paise":5000000}'::jsonb NOT NULL,
	"default_terms" text,
	"default_notes" text,
	"logo_document_id" uuid,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gstin_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"kind" text DEFAULT 'branch' NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state_code" text NOT NULL,
	"pincode" text NOT NULL,
	"phone" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gstins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gstin" text NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text NOT NULL,
	"registration_type" text DEFAULT 'regular' NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state_code" text NOT NULL,
	"pincode" text NOT NULL,
	"phone" text,
	"email" text,
	"einvoice_enabled" boolean DEFAULT true NOT NULL,
	"ewb_enabled" boolean DEFAULT true NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"party_type" text DEFAULT 'customer' NOT NULL,
	"gstin" text,
	"pan" text,
	"registration_type" text DEFAULT 'regular' NOT NULL,
	"email" text,
	"phone" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state_code" text,
	"pincode" text,
	"country" text DEFAULT 'IN' NOT NULL,
	"default_place_of_supply" text,
	"credit_days" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'shipping' NOT NULL,
	"gstin" text,
	"name" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"state_code" text NOT NULL,
	"pincode" text NOT NULL,
	"phone" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hsn_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"default_gst_rate" numeric(5, 2),
	"is_service" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"hsn_sac" text NOT NULL,
	"is_service" boolean DEFAULT false NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cess_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'NOS' NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"qty_decimals" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transporters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"transporter_id" text,
	"phone" text,
	"email" text,
	"address_line1" text,
	"city" text,
	"state_code" text,
	"pincode" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"vehicle_no" text NOT NULL,
	"vehicle_type" text DEFAULT 'R' NOT NULL,
	"transporter_id" uuid,
	"driver_name" text,
	"driver_phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text DEFAULT 'other' NOT NULL,
	"reference" text,
	"notes" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gstin_id" uuid NOT NULL,
	"doc_type" text DEFAULT 'invoice' NOT NULL,
	"series" text DEFAULT 'INV' NOT NULL,
	"financial_year" text NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"padding" integer DEFAULT 4 NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"series" text DEFAULT 'INV' NOT NULL,
	"financial_year" text NOT NULL,
	"doc_type" text DEFAULT 'invoice' NOT NULL,
	"supply_category" text DEFAULT 'b2b' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"einvoice_status" text DEFAULT 'not_required' NOT NULL,
	"ewb_status" text DEFAULT 'not_required' NOT NULL,
	"invoice_date" timestamp with time zone NOT NULL,
	"due_date" timestamp with time zone,
	"gstin_id" uuid NOT NULL,
	"branch_id" uuid,
	"buyer_party_id" uuid,
	"bill_from" jsonb NOT NULL,
	"bill_to" jsonb NOT NULL,
	"dispatch_from" jsonb,
	"ship_to" jsonb,
	"place_of_supply" text NOT NULL,
	"is_export" boolean DEFAULT false NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"igst_on_intra" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"exchange_rate" numeric(12, 4) DEFAULT '1' NOT NULL,
	"export_info" jsonb,
	"gross_value" bigint DEFAULT 0 NOT NULL,
	"total_discount" bigint DEFAULT 0 NOT NULL,
	"taxable_value" bigint DEFAULT 0 NOT NULL,
	"cgst" bigint DEFAULT 0 NOT NULL,
	"sgst" bigint DEFAULT 0 NOT NULL,
	"igst" bigint DEFAULT 0 NOT NULL,
	"cess" bigint DEFAULT 0 NOT NULL,
	"cess_non_advol" bigint DEFAULT 0 NOT NULL,
	"state_cess" bigint DEFAULT 0 NOT NULL,
	"total_tax" bigint DEFAULT 0 NOT NULL,
	"other_charges" bigint DEFAULT 0 NOT NULL,
	"round_off" bigint DEFAULT 0 NOT NULL,
	"grand_total" bigint DEFAULT 0 NOT NULL,
	"amount_paid" bigint DEFAULT 0 NOT NULL,
	"ewb_required" boolean DEFAULT false NOT NULL,
	"transporter_id" uuid,
	"transport_mode" integer,
	"distance_km" integer,
	"vehicle_no" text,
	"vehicle_type" text,
	"transport_doc_no" text,
	"transport_doc_date" timestamp with time zone,
	"sub_supply_type" text DEFAULT '1' NOT NULL,
	"ewb_transaction_type" integer DEFAULT 1 NOT NULL,
	"reference_invoice_id" uuid,
	"reference_invoice_number" text,
	"reference_invoice_date" timestamp with time zone,
	"reason" text,
	"po_number" text,
	"po_date" timestamp with time zone,
	"notes" text,
	"terms" text,
	"finalized_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancel_reason" text,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"hsn_sac" text,
	"amount" bigint DEFAULT 0 NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cgst" bigint DEFAULT 0 NOT NULL,
	"sgst" bigint DEFAULT 0 NOT NULL,
	"igst" bigint DEFAULT 0 NOT NULL,
	"tax_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"hsn_sac" text NOT NULL,
	"is_service" boolean DEFAULT false NOT NULL,
	"barcode" text,
	"batch_no" text,
	"expiry_date" timestamp with time zone,
	"quantity" numeric(16, 3) NOT NULL,
	"unit" text DEFAULT 'NOS' NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"discount_percent" numeric(6, 3) DEFAULT '0' NOT NULL,
	"discount_amount" bigint DEFAULT 0 NOT NULL,
	"gross_value" bigint DEFAULT 0 NOT NULL,
	"taxable_value" bigint DEFAULT 0 NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cgst" bigint DEFAULT 0 NOT NULL,
	"sgst" bigint DEFAULT 0 NOT NULL,
	"igst" bigint DEFAULT 0 NOT NULL,
	"cess_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"cess" bigint DEFAULT 0 NOT NULL,
	"cess_non_advol" bigint DEFAULT 0 NOT NULL,
	"state_cess" bigint DEFAULT 0 NOT NULL,
	"total_tax" bigint DEFAULT 0 NOT NULL,
	"line_total" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "einvoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"gstin" text NOT NULL,
	"provider" text DEFAULT 'nic' NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"irn" text,
	"ack_number" text,
	"ack_date" timestamp with time zone,
	"signed_invoice" text,
	"signed_qr_code" text,
	"ewb_number" text,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"error_code" text,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason_code" text,
	"cancel_remark" text,
	"cancel_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eway_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"gstin" text NOT NULL,
	"provider" text DEFAULT 'nic' NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"ewb_number" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"generated_at" timestamp with time zone,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"distance_km" integer,
	"doc_type" text DEFAULT 'INV' NOT NULL,
	"supply_type" text DEFAULT 'O' NOT NULL,
	"sub_supply_type" text DEFAULT '1' NOT NULL,
	"transaction_type" integer DEFAULT 1 NOT NULL,
	"transporter_id" text,
	"transporter_name" text,
	"transport_mode" integer,
	"vehicle_no" text,
	"vehicle_type" text,
	"transport_doc_no" text,
	"transport_doc_date" timestamp with time zone,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"error_code" text,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"extension_count" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason_code" text,
	"cancel_remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ewb_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"eway_bill_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"note" text,
	"actor_user_id" uuid,
	"actor_label" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"encrypted_token" text NOT NULL,
	"encrypted_sek" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gst_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"gstin_id" uuid NOT NULL,
	"gstin" text NOT NULL,
	"provider" text DEFAULT 'nic' NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"service" text NOT NULL,
	"username_hint" text,
	"encrypted_payload" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_error" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"user_agent" text,
	"ip" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"storage_key" text NOT NULL,
	"storage_provider" text DEFAULT 's3' NOT NULL,
	"checksum_sha256" text,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"gateway" text NOT NULL,
	"operation" text NOT NULL,
	"endpoint" text NOT NULL,
	"gstin" text,
	"idempotency_key" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"request_payload" jsonb,
	"response_status" integer,
	"response_payload" jsonb,
	"error_code" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"kind" text NOT NULL,
	"idempotency_key" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"result" jsonb,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_user_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"summary" text,
	"diff" jsonb,
	"metadata" jsonb,
	"request_id" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" text,
	"read_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gstins" ADD CONSTRAINT "gstins_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_addresses" ADD CONSTRAINT "party_addresses_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transporters" ADD CONSTRAINT "transporters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_transporter_id_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."transporters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_buyer_party_id_parties_id_fk" FOREIGN KEY ("buyer_party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_transporter_id_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."transporters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_charges" ADD CONSTRAINT "invoice_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_charges" ADD CONSTRAINT "invoice_charges_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "einvoices" ADD CONSTRAINT "einvoices_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ewb_events" ADD CONSTRAINT "ewb_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ewb_events" ADD CONSTRAINT "ewb_events_eway_bill_id_eway_bills_id_fk" FOREIGN KEY ("eway_bill_id") REFERENCES "public"."eway_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_tokens" ADD CONSTRAINT "gateway_tokens_credential_id_gst_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."gst_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_tokens" ADD CONSTRAINT "gateway_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_credentials" ADD CONSTRAINT "gst_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_credentials" ADD CONSTRAINT "gst_credentials_gstin_id_gstins_id_fk" FOREIGN KEY ("gstin_id") REFERENCES "public"."gstins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_credentials" ADD CONSTRAINT "gst_credentials_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_calls" ADD CONSTRAINT "gateway_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_tenant_uq" ON "memberships" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_idx" ON "memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "branches_tenant_idx" ON "branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "branches_gstin_idx" ON "branches" USING btree ("gstin_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gstins_tenant_gstin_uq" ON "gstins" USING btree ("tenant_id","gstin");--> statement-breakpoint
CREATE INDEX "gstins_tenant_idx" ON "gstins" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "parties_tenant_idx" ON "parties" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "parties_tenant_name_idx" ON "parties" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "parties_tenant_gstin_idx" ON "parties" USING btree ("tenant_id","gstin");--> statement-breakpoint
CREATE INDEX "party_addresses_tenant_idx" ON "party_addresses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "party_addresses_party_idx" ON "party_addresses" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "hsn_codes_description_idx" ON "hsn_codes" USING btree ("description");--> statement-breakpoint
CREATE INDEX "products_tenant_idx" ON "products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "products_tenant_hsn_idx" ON "products" USING btree ("tenant_id","hsn_sac");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_name_uq" ON "products" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "transporters_tenant_idx" ON "transporters" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transporters_tenant_transid_uq" ON "transporters" USING btree ("tenant_id","transporter_id");--> statement-breakpoint
CREATE INDEX "vehicles_tenant_idx" ON "vehicles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_tenant_vehicle_uq" ON "vehicles" USING btree ("tenant_id","vehicle_no");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_tenant_idx" ON "invoice_payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_sequences_uq" ON "invoice_sequences" USING btree ("tenant_id","gstin_id","doc_type","series","financial_year");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("tenant_id","gstin_id","doc_type","financial_year","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_tenant_idx" ON "invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_idx" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "invoices_tenant_date_idx" ON "invoices" USING btree ("tenant_id","invoice_date");--> statement-breakpoint
CREATE INDEX "invoices_tenant_buyer_idx" ON "invoices" USING btree ("tenant_id","buyer_party_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_einvoice_status_idx" ON "invoices" USING btree ("tenant_id","einvoice_status");--> statement-breakpoint
CREATE INDEX "invoices_tenant_ewb_status_idx" ON "invoices" USING btree ("tenant_id","ewb_status");--> statement-breakpoint
CREATE INDEX "invoice_charges_invoice_idx" ON "invoice_charges" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_charges_tenant_idx" ON "invoice_charges" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_tenant_idx" ON "invoice_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_hsn_idx" ON "invoice_lines" USING btree ("tenant_id","hsn_sac");--> statement-breakpoint
CREATE UNIQUE INDEX "einvoices_invoice_uq" ON "einvoices" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "einvoices_irn_uq" ON "einvoices" USING btree ("irn");--> statement-breakpoint
CREATE INDEX "einvoices_tenant_idx" ON "einvoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "einvoices_tenant_status_idx" ON "einvoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "eway_bills_ewb_number_uq" ON "eway_bills" USING btree ("ewb_number");--> statement-breakpoint
CREATE INDEX "eway_bills_invoice_idx" ON "eway_bills" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "eway_bills_tenant_idx" ON "eway_bills" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "eway_bills_tenant_status_idx" ON "eway_bills" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "eway_bills_valid_until_idx" ON "eway_bills" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "ewb_events_ewb_idx" ON "ewb_events" USING btree ("eway_bill_id");--> statement-breakpoint
CREATE INDEX "ewb_events_tenant_idx" ON "ewb_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_tokens_credential_uq" ON "gateway_tokens" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "gateway_tokens_expires_idx" ON "gateway_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_credentials_uq" ON "gst_credentials" USING btree ("tenant_id","gstin","provider","environment","service");--> statement-breakpoint
CREATE INDEX "gst_credentials_tenant_idx" ON "gst_credentials" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "documents_tenant_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_entity_idx" ON "documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_kind_idx" ON "documents" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "gateway_calls_tenant_idx" ON "gateway_calls" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "gateway_calls_created_idx" ON "gateway_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gateway_calls_idem_idx" ON "gateway_calls" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE INDEX "jobs_tenant_idx" ON "jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "jobs_kind_idx" ON "jobs" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_uq" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_idx" ON "audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_created_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_tenant_idx" ON "notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notifications_tenant_read_idx" ON "notifications" USING btree ("tenant_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");