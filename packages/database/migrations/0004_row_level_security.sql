-- Row-level security as defence in depth.
--
-- The application already scopes every query through `scoped()` /
-- `scopedById()`, and 12 integration tests attack that boundary. RLS is a
-- second, independent barrier: if a query is ever written without the tenant
-- predicate, Postgres refuses the rows rather than returning them.
--
-- Design notes:
--
--  * Policies read `current_setting('traxac.tenant_id', true)`. The `true`
--    means "missing is NULL, not an error", so a connection that has not set
--    it simply sees nothing.
--  * The application's role is NOT marked BYPASSRLS. If it were, the whole
--    exercise would be decorative.
--  * The table owner bypasses RLS by default, so FORCE is required — without
--    it these policies would do nothing in the common single-role setup.
--  * Migrations and the job runner legitimately work across tenants. They set
--    `traxac.bypass = 'on'`, which every policy honours. That is a deliberate,
--    auditable escape hatch rather than an implicit one.

CREATE OR REPLACE FUNCTION traxac_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('traxac.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION traxac_rls_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('traxac.bypass', true), 'off') = 'on'
$$;

DO $$
DECLARE
  target text;
  tenant_tables text[] := ARRAY[
    'gstins', 'branches', 'parties', 'party_addresses', 'products',
    'transporters', 'vehicles', 'invoices', 'invoice_lines', 'invoice_charges',
    'invoice_payments', 'invoice_sequences', 'einvoices', 'eway_bills',
    'ewb_events', 'gst_credentials', 'gateway_tokens', 'documents',
    'audit_logs', 'notifications', 'payment_terms', 'tax_settings',
    'reconciliation_runs', 'reconciliation_items', 'gst_returns',
    'memberships', 'tenant_settings', 'api_keys', 'sessions'
  ];
BEGIN
  FOREACH target IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS traxac_tenant_isolation ON %I', target);
    EXECUTE format($p$
      CREATE POLICY traxac_tenant_isolation ON %I
        USING (traxac_rls_bypass() OR tenant_id = traxac_current_tenant())
        WITH CHECK (traxac_rls_bypass() OR tenant_id = traxac_current_tenant())
    $p$, target);
  END LOOP;
END $$;

-- gateway_calls and jobs carry a nullable tenant_id: platform-level rows
-- legitimately have none, so the policy allows those through explicitly
-- rather than silently hiding them.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['gateway_calls', 'jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS traxac_tenant_isolation ON %I', target);
    EXECUTE format($p$
      CREATE POLICY traxac_tenant_isolation ON %I
        USING (traxac_rls_bypass() OR tenant_id IS NULL OR tenant_id = traxac_current_tenant())
        WITH CHECK (traxac_rls_bypass() OR tenant_id IS NULL OR tenant_id = traxac_current_tenant())
    $p$, target);
  END LOOP;
END $$;

COMMENT ON FUNCTION traxac_current_tenant() IS
  'Tenant for the current connection, from the traxac.tenant_id setting.';
COMMENT ON FUNCTION traxac_rls_bypass() IS
  'True when traxac.bypass=on. Used by migrations and the cross-tenant worker.';
