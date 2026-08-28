import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { orgLogoSrc } from '@/lib/orgLogo';
import { cn } from '@/lib/utils';

/**
 * Switches which organisation you are working in.
 *
 * Only shown when there is somewhere to switch to — someone who belongs to a
 * single organisation and has no platform console sees their organisation
 * name exactly as before.
 */
export function OrgSwitcher() {
  const navigate = useNavigate();
  const { organization, orgName, orgLogo, memberships, switchOrg, canUsePlatformConsole, isPlatformAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const hasChoice = memberships.length > 1 || (canUsePlatformConsole && memberships.length > 0);
  const logo = orgLogoSrc(orgLogo);
  const label = isPlatformAdmin && !organization ? 'Task Platform' : orgName || 'Work-Sync';

  const pick = async (orgId: string) => {
    setOpen(false);
    setBusy(true);
    try {
      await switchOrg(orgId);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not switch organisation');
    } finally {
      setBusy(false);
    }
  };

  const brand = (
    <>
      {logo ? (
        <img
          src={logo}
          alt=""
          className="h-8 w-8 shrink-0 rounded-md object-contain bg-white p-1"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent">
          <ShieldCheck className="h-4.5 w-4.5 text-sidebar-primary" />
        </div>
      )}
      <span className="font-bold text-sm text-sidebar-strong truncate">{label}</span>
    </>
  );

  if (!hasChoice) {
    return <div className="flex items-center gap-3 px-5 h-16 border-b border-sidebar-border">{brand}</div>;
  }

  return (
    <div className="relative border-b border-sidebar-border" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="w-full flex items-center gap-3 px-5 h-16 hover:bg-sidebar-accent/40 disabled:opacity-60"
      >
        {brand}
        {busy ? (
          <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        )}
      </button>

      {open && (
        <div className="absolute left-3 right-3 z-50 mt-1 rounded-md border border-sidebar-border bg-sidebar-background shadow-lg py-1">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground/60">
            Organisations
          </p>
          {memberships.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pick(m.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-sidebar-foreground hover:bg-sidebar-accent/60"
            >
              <Check className={cn('h-4 w-4 shrink-0', organization?.id === m.id ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{m.name}</span>
            </button>
          ))}

          {canUsePlatformConsole && (
            <>
              <div className="my-1 border-t border-sidebar-border" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate('/platform/organisations');
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-sidebar-foreground hover:bg-sidebar-accent/60"
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Platform console
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
