import { useId } from 'react';
import { Link, useLocation } from 'react-router';
import {
  CalendarIcon,
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
  Sheet,
  SheetBackdrop,
  SheetCloseButton,
  SheetDescription,
  SheetFooter,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '@/components/ui/sheet';
import { useCapability } from '@/lib/capabilities';
import { useMemberCard, type MemberCardData } from '@/queries/member-card';
import { useMyGroupRoles } from '@/queries/my-groups';

import {
  memberDisplayName,
  memberSinceLabel,
  type MemberIdentity,
} from './member-identity';

/**
 * The Member Card (CONTEXT.md, ruling R6): the sheet behind every name — a
 * panel from the right on a desktop, rising from the bottom to its content's
 * height on a phone (DESIGN.md, "Four surfaces"). Titled by the Member, as
 * Profil is: the avatar in their colour, the Nickname, then one line of what
 * they are (Role, full name, "Membru din"). Under it the Groups with the
 * Member's Group Role in each and — only for viewers the server lets read
 * it — contact; the links to their pages are pinned at the foot.
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup
          side="bottom"
          data-slot="member-card"
          className="gap-5 p-4 sm:max-w-md sm:p-6"
        >
          <MemberCardBody {...identity} onClose={() => onOpenChange(false)} />
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}

// Mounted only while the sheet is open, so a list of fifty names does not
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
  // The full name follows the Nickname only when it says something new.
  const subtitle = data
    ? data.nickname && data.nickname !== data.fullName
      ? data.fullName
      : null
    : nickname?.trim() && nickname.trim() !== fullName
      ? fullName
      : null;
  const joined = data ? memberSinceLabel(data.joinedAt) : null;
  // A Board Title names the Role (#963); the rank stays beside it.
  const rank =
    data?.rankLabel && data.rankLabel !== data.roleLabel
      ? data.rankLabel
      : null;

  return (
    <>
      {/* The identity is the sheet's header, as on Profil: the avatar, the
          title and the X on one row, then one line of what the Member is. */}
      <div data-slot="member-card-identity" className="grid min-w-0 gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <MemberAvatar
            name={data?.fullName ?? fullName}
            avatarColor={data?.avatarColor ?? avatarColor}
            className="size-12 text-lg"
          />
          <SheetTitle className="min-w-0 flex-1 wrap-anywhere">
            {title}
          </SheetTitle>
          <SheetCloseButton className="-mr-2 shrink-0" />
        </div>
        <SheetDescription
          data-slot="member-card-meta"
          className="m-0 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1"
        >
          {/* The spaces draw nothing in a flex row; they keep the words
              apart where the line is read out as the sheet's description. */}
          {data?.roleLabel && (
            <span className="role-badge">
              <span className="role-dot" aria-hidden="true" />
              {data.roleLabel}
            </span>
          )}{' '}
          {rank && <span>{rank}</span>}{' '}
          {subtitle && <span className="wrap-anywhere">{subtitle}</span>}{' '}
          {joined && (
            <span className="flex items-center gap-1.5">
              <CalendarIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span>{joined}</span>
            </span>
          )}
          {!data?.roleLabel && !rank && !subtitle && !joined && (
            <span>Profil de membru</span>
          )}
        </SheetDescription>
      </div>

      {card.isPending ? (
        <p role="status" className="m-0 text-muted-foreground">
          Se încarcă profilul…
        </p>
      ) : card.isError ? (
        <div role="alert" className="space-y-2">
          <p className="m-0">Nu am putut încărca profilul.</p>
          <Button variant="outline" onClick={() => void card.refetch()}>
            Reîncarcă profilul
          </Button>
        </div>
      ) : !data ? (
        <p className="m-0 text-muted-foreground">
          Profilul nu este disponibil.
        </p>
      ) : (
        <CardSections data={data} ids={ids} onClose={onClose} />
      )}
    </>
  );
}

/** A contact fact: a lucide icon and the value, one 44 px link in the text colour. */
const contactClass =
  'inline-flex min-h-11 max-w-full items-center gap-3 rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

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
  return (
    <>
      {/* Every Group is listed, so there is no "first Group + n" chip above. */}
      {data.groups.length > 0 && (
        <section aria-labelledby={`${ids}-groups`} className="min-w-0">
          <SubHeading id={`${ids}-groups`} variant="label" className="mb-1">
            Grupuri
          </SubHeading>
          <ul className="m-0 list-none divide-y divide-border p-0">
            {data.groups.map((group) => (
              // The name wraps and the Group Role drops under it when the two
              // do not fit side by side: nothing is cut with "…".
              <li
                key={group.id}
                data-slot="member-card-group"
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
              >
                <span className="flex min-w-0 flex-1 basis-40 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: group.color ?? 'var(--brand-red)',
                    }}
                  />
                  <span className="min-w-0 wrap-anywhere">{group.label}</span>
                  <PrivateGroupBadge isPrivate={group.isPrivate} />
                </span>
                <Badge
                  variant="outline"
                  className="ml-auto h-auto max-w-full shrink text-left whitespace-normal wrap-anywhere"
                >
                  {group.roleLabel}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.contact && (
        <section aria-labelledby={`${ids}-contact`} className="min-w-0">
          <SubHeading id={`${ids}-contact`} variant="label" className="mb-1">
            Contact
          </SubHeading>
          <ul className="m-0 list-none p-0">
            {data.contact.email && (
              <li>
                <a
                  href={`mailto:${data.contact.email}`}
                  className={cn(contactClass, 'break-all')}
                >
                  <MailIcon aria-hidden="true" />
                  {data.contact.email}
                </a>
              </li>
            )}
            {data.contact.phone && (
              <li>
                <a href={`tel:${data.contact.phone}`} className={contactClass}>
                  <PhoneIcon aria-hidden="true" />
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
 * The card's links, pinned at the sheet's foot: one filled, the other
 * outline before it (DESIGN.md, "One filled button per surface").
 *
 * - "Vezi trackerul" for leadership (BCE, BC, Moderator). The primary: what a
 *   leader opens a name for is that Member's work.
 * - "Editează" for `manageRoles` (BC, Moderator): the member page.
 * - "Pagina membrului" for a viewer who may open Administrare (`administer`)
 *   and holds a Group Role (Coordonator or Responsabil) in a Group this member
 *   belongs to — the member page is theirs to read for their Groups
 *   (navigation D19). Never both: it is the same page as "Editează".
 *
 * The member page is the primary only where it is the one link offered.
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
  const PageIcon = manageRoles ? PencilIcon : UserIcon;
  return (
    <SheetFooter pinned>
      {/* The footer's one child, so the two links share its row: the
          secondary a third, the primary two thirds, as in a form sheet. */}
      <nav aria-label="Acțiuni pentru membru" className="flex min-w-0 gap-2">
        {page && (
          <Link
            to={memberPage}
            state={from}
            onClick={onClose}
            className={cn(
              buttonVariants({ variant: tracker ? 'outline' : 'default' }),
              'min-w-0 flex-1',
            )}
          >
            <PageIcon aria-hidden="true" />
            {manageRoles ? 'Editează' : 'Pagina membrului'}
          </Link>
        )}
        {tracker && (
          <Link
            to={trackerPage}
            state={from}
            onClick={onClose}
            className={cn(buttonVariants(), 'min-w-0 flex-2')}
          >
            <HistoryIcon aria-hidden="true" />
            Vezi trackerul
          </Link>
        )}
      </nav>
    </SheetFooter>
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
