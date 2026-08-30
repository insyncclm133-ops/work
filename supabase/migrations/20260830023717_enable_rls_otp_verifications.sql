-- ============================================================================
-- 20260830023717_enable_rls_otp_verifications.sql
--
-- otp_verifications has had RLS disabled since 013_otp_verifications.sql
-- ("accessed only via service role in edge functions"), and its public
-- grants were already revoked in 20260814000000_revoke_otp_verifications_
-- public_grants.sql. service_role bypasses RLS regardless of whether it's
-- enabled, so this changes nothing about the edge functions' access — it
-- just closes the RLS-off flag that Health Sentinel's fleet-wide exposure
-- scan (and Supabase's own linter) keeps surfacing on this table.
-- ============================================================================

ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY;
