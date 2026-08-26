import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// Keeps the Redefine Marcom org's membership in step with RMPL, the fleet's
// identity source (reference_fleet_sso.md). The SSO launcher deliberately
// never creates an account on login ("accounts must already exist") — this
// scheduled sync is what keeps that true as RMPL onboards new employees; the
// one-time batch (2026-08-14, 105 employees) only covered a snapshot. Runs
// via cron-worker, mirroring sync-rmpl-projects. Additive only: never edits
// or deactivates anyone already a member of the org.

interface RmplEmployee {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  reports_to: string | null;
  department: string | null;
}

interface WorkProfile {
  id: string;
  email: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function randomPassword(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

const RMPL_EMAIL_DOMAINS = ['redefine.in', 'redefinemarcom.in', 'asrmedia.in'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const rmplApiUrl = Deno.env.get('RMPL_PUBLIC_API_URL');
    const rmplApiKey = Deno.env.get('RMPL_API_KEY');

    if (!rmplApiUrl || !rmplApiKey) {
      return json({ error: 'RMPL_PUBLIC_API_URL / RMPL_API_KEY not configured' }, 500);
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Redefine Marcom is the only org RMPL employees land in.
    const { data: org, error: orgErr } = await admin
      .from('organizations')
      .select('id')
      .eq('name', 'Redefine Marcom')
      .single();
    if (orgErr || !org) {
      return json({ error: 'Redefine Marcom organisation not found' }, 404);
    }

    const rmplRes = await fetch(rmplApiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${rmplApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_employees' }),
    });
    if (!rmplRes.ok) {
      const text = await rmplRes.text().catch(() => '');
      return json({ error: `RMPL fetch failed: ${rmplRes.status} ${text}` }, 502);
    }
    const rmplJson = await rmplRes.json();
    const employees: RmplEmployee[] = rmplJson.data ?? [];
    const byRmplId = new Map(employees.map((e) => [e.id, e]));

    // Match by email against whatever profile already exists here (e.g. the
    // 2026-08-14 batch), so a returning name is reused rather than
    // duplicated. Emails aren't consistently cased between the two apps, so
    // match on the domain set instead of an exact-cased `.in()` list.
    const domainOr = RMPL_EMAIL_DOMAINS.map((d) => `email.ilike.%@${d}`).join(',');
    const { data: existingProfiles, error: profErr } = await admin
      .from('profiles')
      .select('id, email')
      .or(domainOr);
    if (profErr) throw profErr;
    const workIdByEmail = new Map(
      ((existingProfiles ?? []) as WorkProfile[]).map((p) => [p.email.toLowerCase(), p.id]),
    );

    const { data: existingRoles, error: roleErr } = await admin
      .from('user_roles')
      .select('user_id')
      .eq('org_id', org.id)
      .eq('is_active', true);
    if (roleErr) throw roleErr;
    const memberIds = new Set((existingRoles ?? []).map((r) => r.user_id as string));

    const missing = employees.filter((e) => {
      const id = workIdByEmail.get(e.email.toLowerCase());
      return !id || !memberIds.has(id);
    });

    if (missing.length === 0) {
      return json({ success: true, checked: employees.length, created: [], skipped: employees.length });
    }

    const created: string[] = [];
    const errors: { email: string; error: string }[] = [];

    // Phase 1: make sure every missing employee has an auth user + profile,
    // so phase 2 can resolve manager chains even between two people who are
    // both new this run.
    for (const emp of missing) {
      const email = emp.email.toLowerCase();
      if (workIdByEmail.has(email)) continue; // profile exists, only the org role is missing

      const { data: userData, error: createErr } = await admin.auth.admin.createUser({
        email: emp.email,
        password: randomPassword(),
        email_confirm: true,
        user_metadata: { full_name: emp.full_name ?? '' },
      });
      let userId = userData?.user?.id;
      if (createErr || !userId) {
        // An auth user can already exist without a matching profiles row
        // (e.g. a prior run's profile upsert failed after createUser
        // succeeded) — recover it by email instead of retrying forever.
        if (createErr?.message?.toLowerCase().includes('already been registered')) {
          const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          userId = lookup.data?.users?.find((u) => u.email?.toLowerCase() === email)?.id;
        }
        if (!userId) {
          errors.push({ email: emp.email, error: createErr?.message ?? 'createUser failed' });
          continue;
        }
      }

      const { error: profileErr } = await admin
        .from('profiles')
        .upsert(
          {
            id: userId,
            email: emp.email,
            full_name: emp.full_name ?? emp.email,
            phone: emp.phone ?? null,
            is_active: true,
            onboarding_completed: true,
          },
          { onConflict: 'id' },
        );
      if (profileErr) {
        errors.push({ email: emp.email, error: profileErr.message });
        // Only roll back an auth user we just created — never delete one we
        // recovered by lookup, that account predates this run.
        if (!createErr) await admin.auth.admin.deleteUser(userId);
        continue;
      }

      workIdByEmail.set(email, userId);
    }

    // Phase 2: wire reports_to/department + the org role now that every
    // missing employee (and their manager, new or pre-existing) has a
    // Work-Sync id. org_id is only set if the profile doesn't already have
    // an active org (e.g. a platform-admin-owned profile) — never override
    // someone's existing active org.
    for (const emp of missing) {
      const email = emp.email.toLowerCase();
      const userId = workIdByEmail.get(email);
      if (!userId) continue; // creation failed above, already recorded in errors

      const manager = emp.reports_to ? byRmplId.get(emp.reports_to) : null;
      const managerWorkId = manager ? workIdByEmail.get(manager.email.toLowerCase()) ?? null : null;

      const { error: updateErr } = await admin
        .from('profiles')
        .update({ reports_to: managerWorkId, department: emp.department ?? null })
        .eq('id', userId);
      if (updateErr) {
        errors.push({ email: emp.email, error: updateErr.message });
        continue;
      }
      await admin.from('profiles').update({ org_id: org.id }).eq('id', userId).is('org_id', null);

      const { error: roleUpsertErr } = await admin
        .from('user_roles')
        .upsert(
          { org_id: org.id, user_id: userId, role: 'analyst', is_active: true },
          { onConflict: 'user_id,org_id' },
        );
      if (roleUpsertErr) {
        errors.push({ email: emp.email, error: roleUpsertErr.message });
        continue;
      }

      created.push(emp.email);
    }

    return json({
      success: errors.length === 0,
      checked: employees.length,
      created,
      skipped: employees.length - missing.length,
      errors,
    });
  } catch (error) {
    console.error('sync-rmpl-employees failed:', error);
    return json({ error: error instanceof Error ? error.message : 'Sync failed' }, 500);
  }
});
