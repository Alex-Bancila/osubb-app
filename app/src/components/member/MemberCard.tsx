import { useId } from 'react';
import { Link } from 'react-router';
import { HistoryIcon, MailIcon, PencilIcon, PhoneIcon } from 'lucide-react';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { MemberAvatar } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCapability } from '@/lib/capabilities';
import { formatDayMonthYear } from '@/lib/format';
import { useMemberCard, type MemberCardData } from '@/queries/member-card';

import { memberDisplayName, type MemberIdentity } from './member-identity';

/**
 * The Member Card (CONTEXT.md, ruling R6): the pop-up behind every name.
 * Nickname, full name, Role, "Membru din", the first Department with "+n",
 * the Groups and — only for viewers the server lets read it — contact.
 * Task Points and rank never appear here, whatever the surrounding row shows.
 */
export function MemberCard({
  open,
  onOpenChange,
  ...identity
}: MemberIdentity & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-sm">
        <MemberCardBody {...identity} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

const sectionHeading =
  'mb-2 text-[0.7rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase';

// Mounted only while the Dialog is open, so a list of fifty names does not
// read fifty cards.
function MemberCardBody({
  memberId,
  nickname,
  fullName,
  avatarColor,
  onClose,
}: MemberIdentity & { onClose: () => void }) {
  const card = useMemberCard(memberId);
  const data = card.data ?? null;
  const ids = useId();
  const title = data
    ? memberDisplayName(data.nickname, data.fullName)
    : memberDisplayName(nickname, fullName);
  // The full name sits under the Nickname only when it says something new.
  const subtitle = data
    ? data.nickname && data.nickname !== data.fullName
      ? data.fullName
      : null
    : nickname?.trim() && nickname.trim() !== fullName
      ? fullName
      : null;
  const joined = data ? formatDayMonthYear(data.joinedAt) : null;
  const facts = [
    data?.roleLabel,
    joined ? `Membru din ${joined}` : null,
  ].filter(Boolean);
  const ring = data?.primaryGroup?.color ?? 'var(--border)';

  return (
    <>
      <DialogHeader className="flex-row items-center gap-4">
        {/* The frame keeps its size when a photo replaces the initials (#629);
            its ring is the first Group's colour, named by the chip below. */}
        <span
          data-slot="member-photo"
          className="grid size-16 shrink-0 place-items-center rounded-full p-0.5"
          style={{ boxShadow: `0 0 0 2px ${ring}` }}
        >
          <MemberAvatar
            name={data?.fullName ?? fullName}
            avatarColor={data?.avatarColor ?? avatarColor}
            className="size-full text-base"
          />
        </span>
        <div className="min-w-0 space-y-0.5">
          <DialogTitle className="text-lg leading-tight font-bold wrap-anywhere">
            {title}
          </DialogTitle>
          {subtitle && (
            <p className="text-sm font-medium wrap-anywhere">{subtitle}</p>
          )}
          <DialogDescription className="text-xs">
            {facts.length ? facts.join(' · ') : 'Profil de membru'}
          </DialogDescription>
        </div>
      </DialogHeader>

      {card.isPending ? (
        <p role="status" className="text-muted-foreground">
          Se încarcă profilul…
        </p>
      ) : card.isError ? (
        <div role="alert" className="space-y-2">
          <p>Nu am putut încărca profilul.</p>
          <Button variant="outline" onClick={() => void card.refetch()}>
            Reîncarcă profilul
          </Button>
        </div>
      ) : !data ? (
        <p className="text-muted-foreground">Profilul nu este disponibil.</p>
      ) : (
        <CardSections data={data} ids={ids} onClose={onClose} />
      )}
    </>
  );
}

function CardSections({
  data,
  ids,
  onClose,
}: {
  data: MemberCardData;
  ids: string;
  onClose: () => void;
}) {
  const manageRoles = useCapability('manageRoles').data === true;
  const seeLeadership = useCapability('seeLeadership').data === true;
  const { primaryGroup, otherMemberships } = data;
  return (
    <>
      {primaryGroup && (
        <p className="-mt-1 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
            style={{
              borderColor: primaryGroup.color ?? 'var(--border)',
              backgroundColor: primaryGroup.color
                ? `color-mix(in oklab, ${primaryGroup.color} 12%, transparent)`
                : undefined,
            }}
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{
                backgroundColor: primaryGroup.color ?? 'var(--brand-red)',
              }}
            />
            <span className="truncate">{primaryGroup.name}</span>
          </span>
          {otherMemberships > 0 && (
            <span
              className="text-xs font-semibold text-muted-foreground tabular-nums"
              aria-label={
                otherMemberships === 1
                  ? 'și încă un grup'
                  : `și încă ${otherMemberships} grupuri`
              }
            >
              +{otherMemberships}
            </span>
          )}
        </p>
      )}

      {data.groups.length > 0 && (
        <section aria-labelledby={`${ids}-groups`}>
          <h3 id={`${ids}-groups`} className={sectionHeading}>
            Grupuri
          </h3>
          <ul className="max-h-56 divide-y divide-border overflow-y-auto">
            {data.groups.map((group) => (
              <li
                key={group.id}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: group.color ?? 'var(--brand-red)',
                    }}
                  />
                  <span className="truncate">{group.label}</span>
                </span>
                <Badge variant="outline" className="shrink-0">
                  {group.roleLabel}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.contact && (
        <section aria-labelledby={`${ids}-contact`}>
          <h3 id={`${ids}-contact`} className={sectionHeading}>
            Contact
          </h3>
          <ul>
            {data.contact.email && (
              <li>
                <a
                  href={`mailto:${data.contact.email}`}
                  className="inline-flex min-h-11 items-center gap-2 break-all underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <MailIcon aria-hidden="true" className="size-4" />
                  {data.contact.email}
                </a>
              </li>
            )}
            {data.contact.phone && (
              <li>
                <a
                  href={`tel:${data.contact.phone}`}
                  className="inline-flex min-h-11 items-center gap-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <PhoneIcon aria-hidden="true" className="size-4" />
                  {data.contact.phone}
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      {(seeLeadership || manageRoles) && (
        <nav
          aria-label="Acțiuni pentru membru"
          className="flex flex-wrap gap-2 border-t pt-4"
        >
          {seeLeadership && (
            <Link
              to={`/tracker/membru/${data.memberId}`}
              onClick={onClose}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'flex-1',
              )}
            >
              <HistoryIcon aria-hidden="true" />
              Vezi istoricul taskurilor
            </Link>
          )}
          {manageRoles && (
            <Link
              to={`/administrare/membri/${data.memberId}`}
              onClick={onClose}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'flex-1',
              )}
            >
              <PencilIcon aria-hidden="true" />
              Editează
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
