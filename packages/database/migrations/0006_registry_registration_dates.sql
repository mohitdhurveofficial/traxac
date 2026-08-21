-- v1.04 of the IRP taxpayer lookup returns registration and de-registration
-- dates that v1.03 did not. Stored as the portal's own strings: the format is
-- not documented alongside the fields, and guessing between dd/mm/yyyy and
-- yyyy-mm-dd would silently mis-date a registration.

ALTER TABLE gstin_registry ADD COLUMN IF NOT EXISTS registered_on text;
ALTER TABLE gstin_registry ADD COLUMN IF NOT EXISTS deregistered_on text;

COMMENT ON COLUMN gstin_registry.registered_on IS
  'DtReg from the IRP v1.04 lookup, verbatim. Null from the e-Way Bill register.';
