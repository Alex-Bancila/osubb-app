import { useRef, useState, type ReactNode } from 'react';
import { useSwipeTabs } from '../../lib/swipe-tabs';
import { Tabs } from '@base-ui/react/tabs';
import {
  Bell,
  Calendar,
  ChevronRight,
  Moon,
  Pencil,
  SlidersHorizontal,
  Sun,
  UserRound,
} from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router';
import {
  ListRow,
  Page,
  PageGrid,
  PageHeader,
  Panel,
  rowListClass,
  tabClass,
  tabListClass,
  tabThumbClass,
  useActiveTabInView,
} from '../../components/layout';
import { memberDisplayName } from '../../components/member/member-identity';
import { PREFERRED_GROUPS_ANCHOR } from '../../components/preferred-groups/preferred-groups';
import {
  PointsTotal,
  PromotionPanel,
} from '../../components/profile/PromotionProgress';
import { usePromotionProgressState } from '../../components/profile/promotion-state';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { InfoHint } from '../../components/ui/info-hint';
import { useAuth } from '../../lib/auth';
import { safeHexColor } from '../../lib/color';
import { formatDayMonthYear, initials } from '../../lib/format';
import { useTheme } from '../../lib/theme';
import { useMyRoleLabel } from '../../queries/my-role-label';
import { useOrgSettings } from '../../queries/org-settings';
import { useMyPoints } from '../../queries/points';
import { useMyProfile } from '../../queries/profile';
import {
  boardTitleFrom,
  useMyGroups,
  useRoles,
  type GroupMemberRow,
  type MemberGroup,
} from '../../queries/reference';
import EditProfileSheet from './EditProfileSheet';
import { JoiningSection } from './JoiningSection';
import { PHONE_HINT, UNIVERSITY_HINT } from './profile-copy';
import { PushDeviceCard } from './PushDeviceCard';
import { PreferredGroupsCard } from './PreferredGroupsCard';
import { RoleTimeline } from './RoleTimeline';
import { SignOutDeviceLink } from './SignOutDeviceLink';
import { useRoleTimelineShown } from './role-timeline-shown';

/**
 * R13/R18 and #824: from this Level a Member is on the board (BCE, BC) — no
 * points, no Groups list and no joining parts; Funcția în OSUBB instead.
 */
const BOARD_LEVEL = 5;

/** A column of panels that keep their own heights, the grid's gap between. */
const stackClass = 'flex min-w-0 flex-col gap-4 md:gap-6';

/** Profil's tabs, by their `?tab=` value. */
const PROFILE_TABS = ['cont', 'notificari', 'preferinte'] as const;
type ProfileTab = (typeof PROFILE_TABS)[number];
const TAB_KEY = 'tab';

function isProfileTab(value: unknown): value is ProfileTab {
  return PROFILE_TABS.includes(value as ProfileTab);
}

/**
 * The tab an anchor lives on: `/profil#grupuri-preferate` is older than the
 * tabs and still opens the tab its card is on.
 */
const TAB_OF_ANCHOR: Record<string, ProfileTab> = {
  [`#${PREFERRED_GROUPS_ANCHOR}`]: 'preferinte',
};

/**
 * Profilul meu (#824, ruling R27; #859): who the Member is as the page's
 * header, then three tabs, so no setting is a long scroll away.
 *
 * - The header is the identity: avatar, name (the Nickname, with the full
 *   name under it when they differ), the Role chip, the Adunarea Generală
 *   badge and "Membru din …", with two icon buttons — the pencil that opens
 *   Editează profilul, and the theme.
 * - **Cont**: Date personale; the points panel — Punctaj și promovare, which
 *   carries the total, or Punctaj personal when there is no promotion to show
 *   (B38) — or, from level 5, Funcția în OSUBB (BC and BCE have no points,
 *   B45); Grupurile mele; and Parcursul organizațional from its second Role
 *   row (B39).
 * - **Notificări**: push on this device with what arrives as push.
 * - **Preferințe**: Grupuri preferate (R43, BCE and above), Confidențialitate
 *   and, last, the one way out (R41).
 *
 * The tab is in the URL (`?tab=`), so a link or a reload keeps it; the
 * older anchor opens the tab its card is on. Only the open tab is mounted.
 *
 * Every edit of yourself — the profile form and the sign-in address — lives
 * in the Editează profilul sheet; the page shows the address read-only.
 */
export default function ProfileScreen() {
  const { claims } = useAuth();
  const profileQuery = useMyProfile();
  const rolesQuery = useRoles();
  const groupsQuery = useMyGroups();

  const profile = profileQuery.data;
  const memberLevel =
    claims?.member_level ??
    (profile ? rolesQuery.data?.get(profile.role)?.level : undefined) ??
    0;

  const onBoard = memberLevel >= BOARD_LEVEL;
  // #929 (Alex, 2026-09-29): a BCE member belongs to the Adunarea Generală by
  // Role, so their Profil lists their Groups too — beside the board position,
  // without the joining parts (#824). BC and the Moderator, members of every
  // Group, are not listed Group by Group (R32).
  const bceGroups = onBoard && memberLevel < 6;
  // F-7 (#893, Alex 2026-09-29): the Moderator is not a board position; the
  // function is the Role, with no board title to look up or miss.
  // The loaded Profile is current; a claim can lag a Role change.
  const isModerator = profile?.role === 'moderator';
  // Points total applies only to level <= 4 (ruling R13)
  const isPointsEligible = !onBoard;
  const pointsQuery = useMyPoints({ enabled: isPointsEligible });
  // D1: the board title's Group is named by an organization setting.
  const settingsQuery = useOrgSettings({ enabled: onBoard && !isModerator });
  // #963: the header's chip names the Role by the Board Title when set.
  const myRoleLabel = useMyRoleLabel();
  const promotion = usePromotionProgressState();
  const timelineShown = useRoleTimelineShown(profileQuery.data);

  const { theme, toggleTheme } = useTheme();
  const [editOpen, setEditOpen] = useState(false);
  // F-19 (#893): a saved profile says so on the page the sheet closes onto.
  const [saved, setSaved] = useState(false);

  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const asked = params.get(TAB_KEY);
  const tab: ProfileTab = isProfileTab(asked)
    ? asked
    : (TAB_OF_ANCHOR[hash] ?? 'cont');
  const tabStrip = useRef<HTMLDivElement>(null);
  useActiveTabInView(tabStrip, tab);
  // A swipe over the panel moves between the tabs as a tap would (2026-10-11).
  const swipe = useSwipeTabs<ProfileTab>({
    order: PROFILE_TABS,
    current: tab,
    onSelect: (value) => setParams({ [TAB_KEY]: value }, { replace: true }),
  });

  const isPending =
    profileQuery.isPending ||
    rolesQuery.isPending ||
    groupsQuery.isPending ||
    (isPointsEligible && pointsQuery.isPending);

  const isError =
    profileQuery.isError ||
    rolesQuery.isError ||
    groupsQuery.isError ||
    (isPointsEligible && pointsQuery.isError);

  if (isError) {
    return (
      <Page aria-label="Profilul meu">
        <ErrorState
          text="Nu am putut încărca profilul."
          error={
            profileQuery.error ??
            rolesQuery.error ??
            groupsQuery.error ??
            (isPointsEligible ? pointsQuery.error : null)
          }
          onRetry={() => {
            void profileQuery.refetch?.();
            void rolesQuery.refetch?.();
            void groupsQuery.refetch?.();
            if (isPointsEligible) void pointsQuery.refetch?.();
          }}
        />
        {/* R41: the only way out stays reachable when the page cannot load. */}
        <SignOutDeviceLink />
      </Page>
    );
  }

  if (isPending) {
    return (
      <Page aria-label="Profilul meu">
        <Loading label="Se încarcă profilul…" />
      </Page>
    );
  }

  if (!profile) {
    return (
      <Page aria-label="Profilul meu">
        <Empty text="Nu am găsit date despre profilul tău." />
        <SignOutDeviceLink />
      </Page>
    );
  }

  const roleLabel = rolesQuery.data?.get(profile.role)?.name ?? profile.role;
  const isVotingMember =
    profile.role === 'vot' || claims?.member_role === 'vot';
  const hasAdunareaGenerala = isVotingMember || memberLevel >= 3;

  // R5: the Nickname is the name; the full name follows only when it differs.
  const displayName = memberDisplayName(profile.nickname, profile.full_name);
  const showFullName = displayName !== profile.full_name;

  // A milestone, so the day, the month and the year — no weekday.
  const joined = formatDayMonthYear(profile.joined_at);
  const memberSinceLabel = joined ? `Membru din ${joined}` : 'Membru OSUBB';

  const openEdit = () => {
    setSaved(false);
    setEditOpen(true);
  };

  const groupsPanel = (
    <Panel title="Grupurile mele">
      <div data-testid="groups-card">
        <MyGroupsList groups={groupsQuery.data ?? []} />
        {/* The joining parts are for whoever joins by Application (#824). */}
        {!onBoard && <JoiningSection />}
      </div>
    </Panel>
  );

  return (
    <Page className="pb-12">
      {/* The identity is the page's header, in two rows: the avatar, the
          one `PageHeader` whose title is the Member's name and the two icon
          buttons; then one line of what they are (role, Adunarea Generală,
          since when). */}
      <div data-slot="profile-identity" className="grid min-w-0 gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="grid size-12 shrink-0 place-items-center rounded-full text-lg font-bold text-white md:size-14 md:text-xl"
            style={{ backgroundColor: safeHexColor(profile.avatar_color) }}
            aria-hidden="true"
          >
            {initials(profile.full_name)}
          </div>
          <PageHeader className="min-w-0 flex-1" title={displayName} />
          {/* Beside the header, not in its `actions`: those drop under a long
              name on a phone, and these two stay on the name's row. */}
          <div
            data-slot="profile-actions"
            className="flex shrink-0 items-center gap-2"
          >
            <Button
              variant="outline"
              size="icon"
              onClick={openEdit}
              aria-label="Editează profilul"
              title="Editează profilul"
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              aria-label={
                theme === 'dark' ? 'Temă luminoasă' : 'Temă întunecată'
              }
              title={theme === 'dark' ? 'Temă luminoasă' : 'Temă întunecată'}
            >
              {theme === 'dark' ? (
                <Sun aria-hidden="true" />
              ) : (
                <Moon aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
        <div
          data-slot="profile-meta"
          className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground"
        >
          <span className="role-badge">
            <span className="role-dot" aria-hidden="true" />
            {myRoleLabel}
          </span>
          {/* Here, not on the Groups panel, so BC/BCE keep it. */}
          {hasAdunareaGenerala && (
            <Badge
              variant="outline"
              className="border-primary/40 bg-primary/5 font-semibold text-primary"
            >
              Adunarea Generală
            </Badge>
          )}
          {showFullName && (
            <span className="wrap-anywhere" data-testid="profile-full-name">
              {profile.full_name}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Calendar className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{memberSinceLabel}</span>
          </span>
        </div>
      </div>

      {/* Always mounted, so the receipt is announced when it appears
          (as the joining card's); empty, it takes no room. */}
      <p
        role="status"
        className="m-0 text-sm text-muted-foreground empty:hidden"
      >
        {saved && 'Profilul a fost actualizat.'}
      </p>

      <Tabs.Root
        // The tab strip has no margin of its own: this stack spaces it.
        className="flex flex-col gap-6"
        value={tab}
        onValueChange={(value) => {
          if (!isProfileTab(value)) return;
          // Always named, Cont too: an anchor still in the URL would
          // otherwise choose the tab again. A tab is not a history entry.
          setParams({ [TAB_KEY]: value }, { replace: true });
        }}
      >
        <Tabs.List
          ref={tabStrip}
          aria-label="Secțiunile profilului"
          className={tabListClass}
        >
          <Tabs.Indicator className={tabThumbClass} />
          <Tabs.Tab value="cont" className={tabClass}>
            <UserRound aria-hidden="true" />
            Cont
          </Tabs.Tab>
          <Tabs.Tab value="notificari" className={tabClass}>
            <Bell aria-hidden="true" />
            Notificări
          </Tabs.Tab>
          <Tabs.Tab value="preferinte" className={tabClass}>
            <SlidersHorizontal aria-hidden="true" />
            Preferințe
          </Tabs.Tab>
        </Tabs.List>

        <div {...swipe} className="min-w-0">
          <Tabs.Panel value="cont" className="motion-enter outline-none">
            <PageGrid columns={2}>
              <div className={stackClass}>
                <Panel
                  title="Date personale"
                  control={
                    // A pencil fits beside the title at every width; the
                    // labelled button it replaces took a row of the box.
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={openEdit}
                      aria-label="Editează datele personale"
                      title="Editează datele personale"
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  }
                  stack={2}
                >
                  <ul className={rowListClass}>
                    <SettingRow label="E-mail">
                      {profile.email ? (
                        <span className="break-all">{profile.email}</span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          Indisponibil
                        </span>
                      )}
                    </SettingRow>
                    <SettingRow
                      label="Telefon"
                      hint={
                        <InfoHint label="Despre numărul de telefon">
                          {PHONE_HINT}
                        </InfoHint>
                      }
                    >
                      {profile.phone ? (
                        profile.phone
                      ) : (
                        <span className="text-muted-foreground italic">
                          Necompletat
                        </span>
                      )}
                    </SettingRow>
                    {/* R58: BC sets it on the Member's page; here it is read-only. */}
                    <SettingRow
                      label="Universitate"
                      hint={
                        <InfoHint label="Despre universitate">
                          {UNIVERSITY_HINT}
                        </InfoHint>
                      }
                    >
                      {profile.university ? (
                        <span className="wrap-anywhere">
                          {profile.university}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          Necompletată
                        </span>
                      )}
                    </SettingRow>
                  </ul>
                </Panel>
                {(bceGroups || !onBoard) && groupsPanel}
              </div>
              <div className={stackClass}>
                {onBoard ? (
                  <Panel title="Funcția în OSUBB">
                    {isModerator ? (
                      <p
                        data-testid="board-title"
                        className="text-[length:var(--fs-xl)] leading-tight font-extrabold wrap-anywhere text-foreground"
                      >
                        {roleLabel}
                      </p>
                    ) : (
                      <BoardTitle
                        roleLabel={roleLabel}
                        board={
                          profile.role === 'bce'
                            ? 'Biroul de Conducere Extins'
                            : 'Biroul de Conducere'
                        }
                        settings={settingsQuery}
                        membershipRows={groupsQuery.membershipRows}
                      />
                    )}
                  </Panel>
                ) : promotion.kind === 'hidden' ? (
                  <Panel title="Punctaj personal">
                    <div data-testid="personal-points-card">
                      <PointsTotal points={pointsQuery.data ?? 0} />
                    </div>
                  </Panel>
                ) : (
                  <PromotionPanel
                    state={promotion}
                    totalPoints={pointsQuery.data}
                  />
                )}
                {timelineShown && (
                  <Panel title="Parcursul organizațional">
                    <RoleTimeline profile={profile} />
                  </Panel>
                )}
              </div>
            </PageGrid>
          </Tabs.Panel>

          <Tabs.Panel value="notificari" className="motion-enter outline-none">
            <Panel title="Notificări pe acest dispozitiv">
              <PushDeviceCard />
            </Panel>
          </Tabs.Panel>

          <Tabs.Panel value="preferinte" className="motion-enter outline-none">
            <div className={stackClass}>
              {/* R43: BCE, BC and the Moderator only -- nothing for anyone else. */}
              <PreferredGroupsCard />
              {/* The Privacy Notice (#771): always one tap away. */}
              <Panel title="Confidențialitate" flush>
                <ul className={rowListClass}>
                  <ListRow
                    className="relative has-[a:hover]:bg-muted"
                    action={
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    }
                  >
                    <Link
                      to="/confidentialitate"
                      className={`block text-sm font-semibold text-foreground underline-offset-4 after:absolute after:inset-0 hover:underline ${focusRingAfterClass}`}
                    >
                      Politica de confidențialitate
                    </Link>
                    <p className="m-0 text-sm text-muted-foreground">
                      Ce date folosește aplicația, cine le vede și ce drepturi
                      ai.
                    </p>
                  </ListRow>
                </ul>
              </Panel>
              {/* R41: the one way out, last and quiet, after everything else. */}
              <SignOutDeviceLink />
            </div>
          </Tabs.Panel>
        </div>
      </Tabs.Root>

      <EditProfileSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => setSaved(true)}
        profile={profile}
      />
    </Page>
  );
}

/**
 * One setting: its name on the left, its value on the right. A value too
 * long for the row (an email address at 375 px) drops under the name rather
 * than squeezing it.
 */
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  /** An `InfoHint` beside the name: the sentence the value needs once. */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li
      data-slot="setting-row"
      className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5"
    >
      <span className="inline-flex items-center text-sm text-muted-foreground">
        {label}
        {hint}
      </span>
      <span
        data-slot="setting-value"
        className="min-w-0 text-right text-sm font-medium text-foreground"
      >
        {children}
      </span>
    </li>
  );
}

/**
 * Funcția în OSUBB (#824, decision D1): the viewer's own title in the board
 * Group, else the Role label and a line saying none is set.
 */
function BoardTitle({
  roleLabel,
  board,
  settings,
  membershipRows,
}: {
  roleLabel: string;
  /** The board the position is on, said under the title. */
  board: string;
  settings: ReturnType<typeof useOrgSettings>;
  membershipRows: GroupMemberRow[] | undefined;
}) {
  if (settings.isPending) return <Loading label="Se încarcă funcția…" />;
  if (settings.isError) {
    return (
      <ErrorState
        text="Nu am putut încărca funcția."
        error={settings.error}
        onRetry={() => void settings.refetch()}
      />
    );
  }
  const title = boardTitleFrom(
    membershipRows,
    settings.data.get('board_group_id'),
  );
  return (
    <div data-testid="board-title">
      <p className="text-[length:var(--fs-xl)] leading-tight font-extrabold wrap-anywhere text-foreground">
        {title ?? roleLabel}
      </p>
      {/* The title is the information; the board is named once, under
          it (B46). */}
      <p className="mt-1 text-sm text-muted-foreground">{board}</p>
      {!title && (
        <p className="mt-1 text-sm text-muted-foreground">
          Funcția nu este setată încă.
        </p>
      )}
    </div>
  );
}

const GROUP_SECTIONS = [
  // An organization-category Group reaches Profil only by Automatic
  // Membership (#929): the Adunarea Generală, never the Organization Group.
  { category: 'organization', heading: 'Organizație' },
  { category: 'department', heading: 'Departamente' },
  { category: 'team', heading: 'Echipe' },
  { category: 'project', heading: 'Proiecte' },
] as const;

/** The ring round the whole row, drawn by the link's stretched `::after`. */
const focusRingAfterClass =
  'outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-solid focus-visible:after:outline-ring';

/**
 * The Member's Departments, Teams and Projects, each a link to its Group
 * page and, for a Group Role, its title.
 */
function MyGroupsList({ groups }: { groups: MemberGroup[] }) {
  const sections = GROUP_SECTIONS.map((section) => ({
    ...section,
    groups: groups.filter((group) => group.category === section.category),
  })).filter((section) => section.groups.length > 0);

  if (sections.length === 0) {
    return <Empty text="Nu faci parte din nicio echipă încă." />;
  }
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section.category}>
          <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {section.heading}
          </h3>
          <ul className={rowListClass}>
            {section.groups.map((group) => (
              <ListRow
                key={group.id}
                className="relative min-h-11 px-0"
                value={
                  // Plain membership is what the list already says; only a
                  // Group Role earns a badge (B40) — and Automatic Membership
                  // (#929), which no Application or Appointment gave.
                  group.automatic ? (
                    <Badge variant="secondary">{group.role_label}</Badge>
                  ) : group.group_role === 'member' ? undefined : (
                    <Badge variant="outline">{group.role_label}</Badge>
                  )
                }
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{
                      backgroundColor: group.color ?? 'var(--brand-red)',
                    }}
                    aria-hidden="true"
                  />
                  {/* The whole row opens the Group (navigation D8); the name
                      wraps rather than truncating (P3). */}
                  <Link
                    to={`/grupuri/${group.id}`}
                    className={`min-w-0 text-sm font-semibold wrap-anywhere text-foreground underline-offset-4 after:absolute after:inset-0 after:rounded-sm hover:underline ${focusRingAfterClass}`}
                  >
                    {group.name}
                  </Link>
                </span>
              </ListRow>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
