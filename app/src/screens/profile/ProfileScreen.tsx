import { useState } from 'react';
import {
  BellRing,
  Calendar,
  Contact,
  GraduationCap,
  Landmark,
  Mail,
  Moon,
  Pencil,
  ShieldCheck,
  Sun,
  TrendingUp,
  UserRound,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';
import {
  ListRow,
  Page,
  PageGrid,
  PageHeader,
  Panel,
  rowListClass,
} from '../../components/layout';
import { memberDisplayName } from '../../components/member/member-identity';
import {
  PointsTotal,
  PromotionPanel,
} from '../../components/profile/PromotionProgress';
import { usePromotionProgressState } from '../../components/profile/promotion-state';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { safeHexColor } from '../../lib/color';
import { formatLongDate, initials } from '../../lib/format';
import { useTheme } from '../../lib/theme';
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
import { EmailDigestCard } from './EmailDigestCard';
import { JoiningSection } from './JoiningSection';
import { PHONE_HINT } from './profile-copy';
import { PushDeviceCard } from './PushDeviceCard';
import { RoleTimeline } from './RoleTimeline';
import { useRoleTimelineShown } from './role-timeline-shown';

/**
 * R13/R18 and #824: from this Level a Member is on the board (BCE, BC) — no
 * points, no Groups list and no joining parts; Funcția în OSUBB instead.
 */
const BOARD_LEVEL = 5;

/*
 * Rows of unrelated panels (#859, on #876's content-sized `PageGrid`): each
 * panel keeps its own height, and small panels stack in one column beside a
 * tall one. The stack is one grid cell; the panels in it keep the grid's gap
 * between them.
 */
const stackClass = 'flex min-w-0 flex-col gap-4 md:gap-6';

/**
 * Profilul meu (#824, ruling R27; #859): three rows of two columns from
 * `md`, on the layout system. Every panel is as tall as its content (Alex,
 * 2026-09-28: symmetry is aligned edges, never equal boxes more than half
 * empty): beside a tall panel, the small ones stack in one column.
 *
 * - Row 1: Identitate · Date de contact — a like pair, one height.
 * - Row 2: Grupurile mele beside one column holding the points panel — the
 *   Punctaj și promovare panel, which carries the total, or Punctaj personal
 *   when there is no promotion to show (B38) — over Parcursul organizațional.
 *   From level 5: Funcția în OSUBB beside Parcursul organizațional. The
 *   timeline appears only from its second Role row (B39).
 * - Row 3: Notificări pe acest dispozitiv beside Email zilnic over
 *   Confidențialitate.
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
  // F-7 (#893, Alex 2026-09-29): the Moderator is not a board position; the
  // function is the Role, with no board title to look up or miss.
  const isModerator =
    profile?.role === 'moderator' || claims?.member_role === 'moderator';
  // Points total applies only to level <= 4 (ruling R13)
  const isPointsEligible = !onBoard;
  const pointsQuery = useMyPoints({ enabled: isPointsEligible });
  // D1: the board title's Group is named by an organization setting.
  const settingsQuery = useOrgSettings({ enabled: onBoard && !isModerator });
  const promotion = usePromotionProgressState();
  const timelineShown = useRoleTimelineShown(profileQuery.data);

  const { theme, toggleTheme } = useTheme();
  const [editOpen, setEditOpen] = useState(false);
  // F-19 (#893): a saved profile says so on the page the sheet closes onto.
  const [saved, setSaved] = useState(false);

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

  const memberSinceLabel = profile.joined_at
    ? `Membru din ${formatLongDate(new Date(profile.joined_at))}`
    : profile.joined_year
      ? `Membru din ${profile.joined_year}`
      : 'Membru OSUBB';

  const openEdit = () => {
    setSaved(false);
    setEditOpen(true);
  };

  return (
    <Page className="pb-12">
      <PageHeader
        title="Profilul meu"
        description={
          // BC and BCE have no Punctaj on their Profil (B45).
          onBoard
            ? 'Informații personale și setări de cont'
            : 'Informații personale, punctaj și setări de cont'
        }
        actions={
          <Button
            variant="outline"
            onClick={toggleTheme}
            className="w-full gap-2 sm:w-auto"
            aria-label={theme === 'dark' ? 'Temă luminoasă' : 'Temă întunecată'}
          >
            {theme === 'dark' ? (
              <>
                <Sun className="size-4" aria-hidden="true" />
                <span>Temă luminoasă</span>
              </>
            ) : (
              <>
                <Moon className="size-4" aria-hidden="true" />
                <span>Temă întunecată</span>
              </>
            )}
          </Button>
        }
      />

      {/* PageGrid is m-0, which cancels the Page's space-y between rows;
          the rows keep the grid's own gap between them instead. */}
      <div className="flex flex-col gap-4 md:gap-6">
        {/* Always mounted, so the receipt is announced when it appears
            (as the joining card's); empty, it takes no room. */}
        <p
          role="status"
          className="m-0 text-sm text-muted-foreground empty:hidden"
        >
          {saved && 'Profilul a fost actualizat.'}
        </p>
        {/* A like pair, each ending in its Editează button: one height. */}
        <PageGrid columns={2} equalHeights>
          <Panel eyebrow="Cont" icon={UserRound} title="Identitate">
            <div className="flex h-full flex-col gap-4">
              <div className="flex min-w-0 items-start gap-4">
                <div
                  className="grid size-16 shrink-0 place-items-center rounded-full text-xl font-bold text-white"
                  style={{
                    backgroundColor: safeHexColor(profile.avatar_color),
                  }}
                  aria-hidden="true"
                >
                  {initials(profile.full_name)}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="min-w-0">
                    <h3 className="m-0 text-lg font-bold wrap-anywhere text-foreground">
                      {displayName}
                    </h3>
                    {showFullName && (
                      <p
                        className="text-sm wrap-anywhere text-muted-foreground"
                        data-testid="profile-full-name"
                      >
                        {profile.full_name}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="role-badge">
                      <span className="role-dot" aria-hidden="true" />
                      {roleLabel}
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
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="size-3.5" aria-hidden="true" />
                    <span>{memberSinceLabel}</span>
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="mt-auto w-full gap-2"
                onClick={openEdit}
              >
                <Pencil className="size-4" aria-hidden="true" />
                <span>Editează profilul</span>
              </Button>
            </div>
          </Panel>

          <Panel eyebrow="Cont" icon={Contact} title="Date de contact">
            <div className="flex h-full flex-col gap-2">
              <ul className={rowListClass}>
                <ListRow className="px-0">
                  <p className="text-xs font-semibold text-muted-foreground">
                    E-mail
                  </p>
                  <p className="text-sm font-medium break-all text-foreground">
                    {profile.email ?? (
                      <span className="text-muted-foreground italic">
                        Indisponibil
                      </span>
                    )}
                  </p>
                </ListRow>
                <ListRow className="px-0">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Telefon
                  </p>
                  <p className="text-sm font-medium text-foreground">
                    {profile.phone ? (
                      profile.phone
                    ) : (
                      <span className="text-muted-foreground italic">
                        Necompletat
                      </span>
                    )}
                  </p>
                </ListRow>
              </ul>
              <p className="text-xs text-muted-foreground">{PHONE_HINT}</p>
              {/* In the box, not the header: a header control would wrap under
              the title in a third of the row and push this box down. */}
              <Button
                variant="outline"
                className="mt-auto w-full gap-2"
                onClick={openEdit}
                aria-label="Editează datele de contact"
              >
                <Pencil className="size-4" aria-hidden="true" />
                <span>Editează</span>
              </Button>
            </div>
          </Panel>
        </PageGrid>

        <PageGrid columns={2}>
          {onBoard ? (
            <Panel
              eyebrow={
                // No area for the Moderator (ruling 2: no eyebrow then).
                isModerator
                  ? undefined
                  : profile.role === 'bce'
                    ? 'Biroul de Conducere Extins'
                    : 'Biroul de Conducere'
              }
              icon={Landmark}
              title="Funcția în OSUBB"
              // Alone in its row it takes the row: a half-width box with
              // nothing beside it reads as a missing neighbour.
              className={timelineShown ? undefined : 'md:col-span-2'}
            >
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
                  settings={settingsQuery}
                  membershipRows={groupsQuery.membershipRows}
                />
              )}
            </Panel>
          ) : (
            <Panel eyebrow="Grupuri" icon={Users} title="Grupurile mele">
              <div data-testid="groups-card">
                <MyGroupsList groups={groupsQuery.data ?? []} />
                <JoiningSection />
              </div>
            </Panel>
          )}
          {(!onBoard || timelineShown) && (
            <div className={stackClass}>
              {!onBoard &&
                (promotion.kind === 'hidden' ? (
                  <Panel
                    eyebrow="Parcurs"
                    icon={TrendingUp}
                    title="Punctaj personal"
                  >
                    <div data-testid="personal-points-card">
                      <PointsTotal points={pointsQuery.data ?? 0} />
                    </div>
                  </Panel>
                ) : (
                  <PromotionPanel
                    state={promotion}
                    totalPoints={pointsQuery.data}
                  />
                ))}
              {timelineShown && (
                <Panel
                  eyebrow="Parcurs"
                  icon={GraduationCap}
                  title="Parcursul organizațional"
                >
                  <RoleTimeline profile={profile} />
                </Panel>
              )}
            </div>
          )}
        </PageGrid>

        <PageGrid columns={2}>
          <Panel
            eyebrow="Setări"
            icon={BellRing}
            title="Notificări pe acest dispozitiv"
          >
            <PushDeviceCard />
          </Panel>
          <div className={stackClass}>
            <Panel eyebrow="Setări" icon={Mail} title="Email zilnic">
              <EmailDigestCard />
            </Panel>
            {/* The Privacy Notice (#771): always one tap away. */}
            <Panel
              eyebrow="Setări"
              icon={ShieldCheck}
              title="Confidențialitate"
            >
              <p className="text-sm text-muted-foreground">
                Ce date folosește aplicația, cine le vede și ce drepturi ai.
              </p>
              <Link
                to="/confidentialitate"
                className="mt-1 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
              >
                Politica de confidențialitate
              </Link>
            </Panel>
          </div>
        </PageGrid>
      </div>

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
 * Funcția în OSUBB (#824, decision D1): the viewer's own title in the board
 * Group, else the Role label and a line saying none is set.
 */
function BoardTitle({
  roleLabel,
  settings,
  membershipRows,
}: {
  roleLabel: string;
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
      {/* The title is the information; the Role is on the Identitate chip
          and in the eyebrow already (B46). */}
      {!title && (
        <p className="mt-1 text-sm text-muted-foreground">
          Funcția nu este setată încă.
        </p>
      )}
    </div>
  );
}

const GROUP_SECTIONS = [
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
                  // Group Role earns a badge (B40).
                  group.group_role === 'member' ? undefined : (
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
