-- Whether the IRP's JWS signatures were actually verified for a document.
--
-- The signature is what makes an IRN self-provable offline. Storing the
-- outcome per document matters because the signing certificate may be
-- configured later: records signed before that must keep reading "unverified"
-- rather than retroactively appearing verified.
--
-- States: verified | invalid | unverified | absent | malformed.
-- NULL means the document predates verification being wired in.

ALTER TABLE einvoices ADD COLUMN IF NOT EXISTS signed_invoice_verification text;
ALTER TABLE einvoices ADD COLUMN IF NOT EXISTS signed_qr_verification text;
ALTER TABLE einvoices ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE einvoices ADD COLUMN IF NOT EXISTS verification_error text;

COMMENT ON COLUMN einvoices.signed_invoice_verification IS
  'verified | invalid | unverified | absent | malformed. Never "verified" without a real check.';
