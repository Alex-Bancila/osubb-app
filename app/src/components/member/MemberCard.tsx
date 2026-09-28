import { useId } from 'react';
import { Link, useLocation } from 'react-router';
import {
  HistoryIcon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  UserIcon,
} from 'lucide-react';
import { cn } from 'cn';
import { PrivateGroupBadge } from '@/components/group/PrivateGroupBadge';
import { backLinkState, SubHeading } from '@/components/layout';
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
import { useMyGroupRoles } from '@/queries/my-groups';

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
      {/* One shrinkable column: a long Group Role label wraps or truncates
          inside the dialog instead of widening it past 375 px (layout N3). */}
      <DialogContent className="grid-cols-[minmax(0,1fr)] gap-5 sm:max-w-sm">
        <MemberCardBody {...identity} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

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
      <DialogHeader className="min-w-0 flex-row items-center gap-4">
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
          {/* The dialog's own title size (#842): no override here. */}
          <DialogTitle className="wrap-anywhere">{title}</DialogTitle>
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

const actionClass = cn(
  buttonVariants({ variant: 'outline', size: 'sm' }),
  'min-w-0',
);

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
  const administer = useCapability('administer').data === true;
  const { primaryGroup, otherMemberships } = data;
  return (
    <>
      {primaryGroup && (
        <p className="-mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <span
            className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
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
            <PrivateGroupBadge isPrivate={primaryGroup.isPrivate} compact />
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
        <section aria-labelledby={`${ids}-groups`} className="min-w-0">
          <SubHeading id={`${ids}-groups`} className="mb-2">
            Grupuri
          </SubHeading>
          <ul className="max-h-56 divide-y divide-border overflow-y-auto">
            {data.groups.map((group) => (
              <li
                key={group.id}
                className="flex min-w-0 items-center justify-between gap-3 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: group.color ?? 'var(--brand-red)',
                    }}
                  />
                  <span className="truncate" title={group.label}>
                    {group.label}
                  </span>
                  <PrivateGroupBadge isPrivate={group.isPrivate} />
                </span>
                {/* A long position ("Responsabil logistică și voluntari")
                    truncates at half the row, with the whole label on hover. */}
                <Badge
                  variant="outline"
                  className="max-w-1/2 min-w-0 shrink-0 justify-start"
                  title={group.roleLabel}
                >
                  <span className="truncate">{group.roleLabel}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.contact && (
        <section aria-labelledby={`${ids}-contact`} className="min-w-0">
          <SubHeading id={`${ids}-contact`} className="mb-2">
            Contact
          </SubHeading>
          <ul>
            {data.contact.email && (
              <li>
                <a
                  href={`mailto:${data.contact.email}`}
                  className="inline-flex min-h-11 items-center gap-2 break-all underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <MailIcon aria-hidden="true" className="size-4 shrink-0" />
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
                  <PhoneIcon aria-hidden="true" className="size-4 shrink-0" />
                  {data.contact.phone}
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      {(seeLeadership || manageRoles || administer) && (
        <CardActions
          data={data}
          seeLeadership={seeLeadership}
          manageRoles={manageRoles}
          administer={administer}
          onClose={onClose}
        />
      )}
    </>
  );
}

/**
 * The card's links, in one grid inside the dialog's padding: two columns
 * when both fit, one under the other on a narrow phone.
 *
 * - "Vezi trackerul" for leadership (BCE, BC, Moderator).
 * - "Editează" for `manageRoles` (BC, Moderator): the member page.
 * - "Pagina membrului" for a viewer who may open Administrare (`administer`)
 *   and holds a Group Role (Coordonator or Responsabil) in a Group this member
 *   belongs to — the member page is theirs to read for their Groups
 *   (navigation D19). Never both: it is the same page as "Editează".
 */
function CardActions({
  data,
  seeLeadership,
  manageRoles,
  administer,
  onClose,
}: {
  data: MemberCardData;
  seeLeadership: boolean;
  manageRoles: boolean;
  administer: boolean;
  onClose: () => void;
}) {
  const leads = useLeadsAGroupOf(data, administer && !manageRoles);
  if (!seeLeadership && !manageRoles && !leads) return null;
  return (
    <CardLinks
      data={data}
      seeLeadership={seeLeadership}
      manageRoles={manageRoles}
      leads={leads}
      onClose={onClose}
    />
  );
}

function CardLinks({
  data,
  seeLeadership,
  manageRoles,
  leads,
  onClose,
}: {
  data: MemberCardData;
  seeLeadership: boolean;
  manageRoles: boolean;
  leads: boolean;
  onClose: () => void;
}) {
  const location = useLocation();
  // The page that opens from here goes back here, not to its own parent
  // (navigation D10).
  const from = backLinkState(location);
  const trackerPage = `/tracker/membru/${data.memberId}`;
  const memberPage = `/administrare/membri/${data.memberId}`;
  // A link to the page already open would only point that page's back link
  // at itself: the card offers the other pages, not this one.
  const tracker = seeLeadership && location.pathname !== trackerPage;
  const page = (manageRoles || leads) && location.pathname !== memberPage;
  if (!tracker && !page) return null;
  return (
    <nav
      aria-label="Acțiuni pentru membru"
      className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2 border-t pt-4"
    >
      {tracker && (
        <Link
          to={trackerPage}
          state={from}
          onClick={onClose}
          className={actionClass}
        >
          <HistoryIcon aria-hidden="true" />
          Vezi trackerul
        </Link>
      )}
      {page &&
        (manageRoles ? (
          <Link
            to={memberPage}
            state={from}
            onClick={onClose}
            className={actionClass}
          >
            <PencilIcon aria-hidden="true" />
            Editează
          </Link>
        ) : (
          <Link
            to={memberPage}
            state={from}
            onClick={onClose}
            className={actionClass}
          >
            <UserIcon aria-hidden="true" />
            Pagina membrului
          </Link>
        ))}
    </nav>
  );
}

/**
 * Whether the viewer holds a Group Role — Coordonator (`manager`) or
 * Responsabil (`responsible`), their own or inherited from an ancestor — in a
 * Group the member belongs to. It reads the same cached, live `my_groups()`
 * as the rest of the app (ruling R29), not the token's `group_ids`.
 */
function useLeadsAGroupOf(data: MemberCardData, enabled: boolean): boolean {
  const mine = useMyGroupRoles();
  if (!enabled || !mine.data) return false;
  const led = new Set(
    mine.data
      .filter(
        (group) =>
          group.group_role === 'manager' || group.group_role === 'responsible',
      )
      .map((group) => group.id),
  );
  return data.groups.some((group) => led.has(group.id));
}
