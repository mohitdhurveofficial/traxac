-- Verified taxpayer and transporter details, cached per tenant.
--
-- The government register is the source of truth; this is a local copy with
-- an explicit `fetched_at` so nothing is ever shown as current without saying
-- when it was last confirmed. `kind` keeps the two registers apart: a TRANSIN
-- belongs to an enrolled transporter who has no registration status, and must
-- never be able to answer a question about whether a GSTIN is active.

CREATE TABLE IF NOT EXISTS gstin_registry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  identifier      text NOT NULL,

  legal_name      text,
  trade_name      text,
  status          text,
  status_raw      text,
  taxpayer_type   text,
  block_status    text,
  address_line1   text,
  address_line2   text,
  -- The IRP breaks the address into more parts than the e-Way Bill portal.
  -- Kept individually so a cached read returns the same shape as a fresh one.
  street          text,
  location        text,
  floor_number    text,
  building_number text,
  building_name   text,
  state_code      text,
  pincode         text,
  jurisdiction    text,

  source          text NOT NULL,
  environment     text NOT NULL,
  raw             jsonb,
  fetched_at      timestamptz NOT NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gstin_registry_kind_ck CHECK (kind IN ('gstin', 'transin')),
  CONSTRAINT gstin_registry_source_ck CHECK (source IN ('irp', 'ewb'))
);

CREATE UNIQUE INDEX IF NOT EXISTS gstin_registry_uq
  ON gstin_registry (tenant_id, kind, identifier);
CREATE INDEX IF NOT EXISTS gstin_registry_tenant_idx ON gstin_registry (tenant_id);
CREATE INDEX IF NOT EXISTS gstin_registry_fetched_idx ON gstin_registry (fetched_at);

-- Same tenant isolation every other tenant table carries. Without this the
-- table would be the one hole in the RLS boundary established in 0004.
ALTER TABLE gstin_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE gstin_registry FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS traxac_tenant_isolation ON gstin_registry;
CREATE POLICY traxac_tenant_isolation ON gstin_registry
  USING (traxac_rls_bypass() OR tenant_id = traxac_current_tenant())
  WITH CHECK (traxac_rls_bypass() OR tenant_id = traxac_current_tenant());

COMMENT ON TABLE gstin_registry IS
  'Per-tenant cache of GSTIN and TRANSIN lookups, with the time the portal answered.';
COMMENT ON COLUMN gstin_registry.fetched_at IS
  'When the government portal actually answered. Drives staleness and the refresh action.';
