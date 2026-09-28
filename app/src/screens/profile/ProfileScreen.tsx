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
  Sparkles,
  Sun,
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
  type PageGridColumns,
} from '../../components/layout';
import { memberDisplayName } from '../../components/member/member-identity';
import { PromotionPanel } from '../../components/profile/PromotionProgress';
import { usePromotionProgressState } from '../../components/profile/promotion-state';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { safeHexColor } from '../../lib/color';
import { formatLongDate, formatPoints, initials } from '../../lib/format';
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
import { PushDeviceCard } from './PushDeviceCard';
import { RoleTimeline } from './RoleTimeline';

/**
 * R13/R18 and #824: from this Level a Member is on the board (BCE, BC) — no
 * points, no Groups list and no joining parts; Funcția în OSUBB instead.
 */
const BOARD_LEVEL = 5;

/**
 * Profilul meu (#824, ruling R27; pages-pass plan §4): three rows of equal
 * panels on the layout system.
 *
 * - Row 1: Identitate · Punctaj personal (level ≤ 4) or Funcția în OSUBB
 *   (level ≥ 5) · Date de contact.
 * - Row 2: Grupurile mele (below level 5) · Parcursul organizațional ·
 *   Promovare (only when there is something to show) — as many columns as
 *   panels present.
 * - Row 3: Notificări pe acest dispozitiv · Email zilnic · Confidențialitate.
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
  // Points total applies only to level <= 4 (ruling R13)
  const isPointsEligible = !onBoard;
  const pointsQuery = useMyPoints({ enabled: isPointsEligible });
  // D1: the board title's Group is named by an organization setting.
  const settingsQuery = useOrgSettings({ enabled: onBoard });
  const promotion = usePromotionProgressState();

  const { theme, toggleTheme } = useTheme();
  const [editOpen, setEditOpen] = useState(false);

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

  // Row 2 has as many columns as panels: Groups below the board, the
  // timeline always, Promovare only when it has something to show.
  const rowTwoColumns = ((onBoard ? 0 : 1) +
    1 +
    (promotion.kind === 'hidden' ? 0 : 1)) as PageGridColumns;
  const openEdit = () => setEditOpen(true);

  return (
    <Page className="pb-12">
      <PageHeader
        title="Profilul meu"
        description="Informații personale, punctaj și setări de cont"
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
        <PageGrid columns={3}>
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

          {isPointsEligible ? (
            <Panel eyebrow="Punctaj" icon={Sparkles} title="Punctaj personal">
              <div
                className="flex flex-wrap items-baseline gap-3"
                data-testid="personal-points-card"
              >
                <span className="text-[length:var(--fs-2xl)] leading-none font-extrabold text-foreground tabular-nums">
                  {formatPoints(pointsQuery.data ?? 0)}
                </span>
                <span className="text-base font-semibold text-muted-foreground">
                  puncte
                </span>
              </div>
            </Panel>
          ) : (
            <Panel
              eyebrow={
                profile.role === 'bce'
                  ? 'Biroul de Conducere Extins'
                  : 'Biroul de Conducere'
              }
              icon={Landmark}
              title="Funcția în OSUBB"
            >
              <BoardTitle
                roleLabel={roleLabel}
                settings={settingsQuery}
                membershipRows={groupsQuery.membershipRows}
              />
            </Panel>
          )}

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
              <p className="text-xs text-muted-foreground">
                Numărul de telefon este vizibil doar pentru tine și membrii cu
                nivel ≥5.
              </p>
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

        <PageGrid columns={rowTwoColumns}>
          {!onBoard && (
            <Panel eyebrow="Grupuri" icon={Users} title="Grupurile mele">
              <div data-testid="groups-card">
                <MyGroupsList groups={groupsQuery.data ?? []} />
                <JoiningSection />
              </div>
            </Panel>
          )}
          <Panel
            eyebrow="Parcurs"
            icon={GraduationCap}
            title="Parcursul organizațional"
          >
            <RoleTimeline profile={profile} />
          </Panel>
          {promotion.kind !== 'hidden' && <PromotionPanel state={promotion} />}
        </PageGrid>

        <PageGrid columns={3}>
          <Panel
            eyebrow="Setări"
            icon={BellRing}
            title="Notificări pe acest dispozitiv"
          >
            <PushDeviceCard />
          </Panel>
          <Panel eyebrow="Setări" icon={Mail} title="Email zilnic">
            <EmailDigestCard />
          </Panel>
          {/* The Privacy Notice (#771): always one tap away. */}
          <Panel eyebrow="Setări" icon={ShieldCheck} title="Confidențialitate">
            <p className="text-sm text-muted-foreground">
              Ce date folosește aplicația, cine le vede și ce drepturi ai.
            </p>
            <Link
              to="/confidentialitate"
              className="mt-3 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
            >
              Politica de confidențialitate
            </Link>
          </Panel>
        </PageGrid>
      </div>

      <EditProfileSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
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
      <p className="mt-1 text-sm text-muted-foreground">
        {title ? `${roleLabel} · OSUBB` : 'Funcția nu este setată încă.'}
      </p>
    </div>
  );
}

const GROUP_SECTIONS = [
  { category: 'department', heading: 'Departamente' },
  { category: 'team', heading: 'Echipe' },
  { category: 'project', heading: 'Proiecte' },
] as const;

/** The Member's Departments, Teams and Projects, each with its Group Role. */
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
                className="min-h-11 px-0"
                value={<Badge variant="outline">{group.role_label}</Badge>}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{
                      backgroundColor: group.color ?? 'var(--brand-red)',
                    }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-sm font-semibold text-foreground">
                    {group.name}
                  </span>
                </span>
              </ListRow>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
