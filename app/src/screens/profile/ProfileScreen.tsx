import { useState } from 'react';
import {
  Calendar,
  Lock,
  Mail,
  Moon,
  Pencil,
  Phone,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import { memberDisplayName } from '../../components/member/member-identity';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { formatLongDate, formatPoints, initials } from '../../lib/format';
import { useTheme } from '../../lib/theme';
import { useMyPoints } from '../../queries/points';
import { useMyProfile } from '../../queries/profile';
import { useMyGroups, useRoles } from '../../queries/reference';
import EditProfileSheet from './EditProfileSheet';
import RoleTimeline from './RoleTimeline';
import { JoiningSection } from './JoiningSection';
import { PushDeviceCard } from './PushDeviceCard';

/** R18: the joining parts of the Groups card stop at this Level. */
const JOINING_LEVEL_LIMIT = 5;

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

  // Points total applies only to level <= 4 (ruling R13)
  const isPointsEligible = memberLevel <= 4;
  const pointsQuery = useMyPoints({ enabled: isPointsEligible });

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
      <section className="page">
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
      </section>
    );
  }

  if (isPending) {
    return (
      <section className="page">
        <Loading label="Se încarcă profilul…" />
      </section>
    );
  }

  if (!profile) {
    return (
      <section className="page">
        <Empty text="Nu am găsit date despre profilul tău." />
      </section>
    );
  }

  const roleLabel = rolesQuery.data?.get(profile.role)?.name ?? profile.role;
  const isVotingMember =
    profile.role === 'vot' || claims?.member_role === 'vot';
  const hasAdunareaGenerala = isVotingMember || memberLevel >= 3;
  // R18: below level 5 the Groups card is also where a Member joins more.
  const canJoinGroups = memberLevel < JOINING_LEVEL_LIMIT;

  // R5: the Nickname is the name; the full name follows only when it differs.
  const displayName = memberDisplayName(profile.nickname, profile.full_name);
  const showFullName = displayName !== profile.full_name;

  const memberSinceLabel = profile.joined_at
    ? `Membru din ${formatLongDate(new Date(profile.joined_at))}`
    : profile.joined_year
      ? `Membru din ${profile.joined_year}`
      : 'Membru OSUBB';

  const memberGroups = groupsQuery.data ?? [];
  const departments = memberGroups.filter((g) => g.category === 'department');
  const teams = memberGroups.filter((g) => g.category === 'team');
  const projects = memberGroups.filter((g) => g.category === 'project');
  const hasAnyGroups =
    departments.length > 0 || teams.length > 0 || projects.length > 0;

  return (
    <section className="page pb-12">
      {/* Header */}
      <header className="page-head flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Profilul meu</h1>
          <p className="page-date">
            Informații personale, punctaj și setări de cont
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={toggleTheme}
            className="gap-2"
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
        </div>
      </header>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column (Identity & Contact) */}
        <div className="flex flex-col gap-6 lg:col-span-1">
          {/* Identity Card */}
          <section className="card flex flex-col items-center p-6 text-center sm:items-start sm:text-left">
            <div className="flex w-full flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div
                className="grid size-20 shrink-0 place-items-center rounded-full text-2xl font-bold text-white shadow-md"
                style={{
                  backgroundColor: profile.avatar_color ?? 'var(--brand-red)',
                }}
                aria-hidden="true"
              >
                {initials(profile.full_name)}
              </div>

              <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:items-start">
                <div className="flex min-w-0 flex-col items-center sm:items-start">
                  <h2 className="break-words text-xl font-bold text-foreground">
                    {displayName}
                  </h2>
                  {showFullName && (
                    <p
                      className="break-words text-sm text-muted-foreground"
                      data-testid="profile-full-name"
                    >
                      {profile.full_name}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-center gap-1 sm:items-start">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Rol organizațional
                  </span>
                  <span className="role-badge">
                    <span className="role-dot" aria-hidden="true" />
                    {roleLabel}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="size-3.5" aria-hidden="true" />
                  <span>{memberSinceLabel}</span>
                </p>
              </div>
            </div>

            <div className="mt-6 w-full border-t border-border pt-4">
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="size-4" aria-hidden="true" />
                <span>Editează profil</span>
              </Button>
            </div>
          </section>

          {/* Role Timeline */}
          <RoleTimeline profile={profile} />

          {/* Contact Fields Card */}
          <section className="card p-6">
            <div className="card-head">
              <h3 className="card-title flex items-center gap-2">
                <Mail className="size-5 text-primary" aria-hidden="true" />
                <span>Date de contact</span>
              </h3>
            </div>

            <dl className="flex flex-col gap-4 text-sm">
              <div>
                <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Adresă de email</span>
                  <Lock
                    className="size-3 text-muted-foreground"
                    aria-hidden="true"
                  />
                </dt>
                <dd className="mt-1 font-medium text-foreground break-all">
                  {profile.email ?? (
                    <span className="text-muted-foreground italic">
                      Indisponibil
                    </span>
                  )}
                </dd>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Autentificarea se face prin link sau cod trimis la această
                  adresă.
                </p>
              </div>

              <div className="border-t border-border pt-3">
                <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Phone className="size-3.5" aria-hidden="true" />
                  <span>Număr de telefon</span>
                </dt>
                <dd className="mt-1 font-medium text-foreground">
                  {profile.phone ? (
                    profile.phone
                  ) : (
                    <span className="text-muted-foreground italic">
                      Necompletat
                    </span>
                  )}
                </dd>
                <p className="mt-1 text-xs text-muted-foreground">
                  Numărul de telefon este vizibil doar pentru tine și membrii cu
                  nivel ≥5.
                </p>
              </div>
            </dl>
          </section>
        </div>

        {/* Right Column (Points & Groups) */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Points Total Card — only for level <= 4 (ruling R13) */}
          {isPointsEligible && (
            <section className="card p-6" data-testid="personal-points-card">
              <div className="card-head">
                <h3 className="card-title flex items-center gap-2">
                  <Sparkles
                    className="size-5 text-primary"
                    aria-hidden="true"
                  />
                  <span>Punctaj personal</span>
                </h3>
              </div>

              <div className="flex flex-wrap items-baseline gap-3">
                <span className="bignum text-foreground">
                  {formatPoints(pointsQuery.data ?? 0)}
                </span>
                <span className="text-base font-semibold text-muted-foreground">
                  puncte
                </span>
              </div>
            </section>
          )}

          {/* Groups Card */}
          <section className="card p-6" data-testid="groups-card">
            <div className="card-head flex items-center justify-between">
              <h3 className="card-title flex items-center gap-2">
                <Users className="size-5 text-primary" aria-hidden="true" />
                <span>{canJoinGroups ? 'Grupurile mele' : 'Grupuri'}</span>
              </h3>
              {hasAdunareaGenerala && (
                <Badge
                  variant="outline"
                  className="font-semibold text-primary border-primary/40 bg-primary/5"
                >
                  Adunarea Generală
                </Badge>
              )}
            </div>

            {!hasAnyGroups ? (
              <Empty text="Nu faci parte din nicio echipă încă." />
            ) : (
              <div className="flex flex-col gap-6">
                {departments.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Departamente
                    </h4>
                    <ul className="flex flex-col divide-y divide-border">
                      {departments.map((group) => (
                        <li
                          key={group.id}
                          className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className="size-3 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  group.color ?? 'var(--brand-red)',
                              }}
                              aria-hidden="true"
                            />
                            <span className="truncate text-sm font-semibold text-foreground">
                              {group.name}
                            </span>
                          </div>
                          <Badge variant="outline">{group.role_label}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {teams.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Echipe
                    </h4>
                    <ul className="flex flex-col divide-y divide-border">
                      {teams.map((group) => (
                        <li
                          key={group.id}
                          className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className="size-3 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  group.color ?? 'var(--brand-red)',
                              }}
                              aria-hidden="true"
                            />
                            <span className="truncate text-sm font-semibold text-foreground">
                              {group.name}
                            </span>
                          </div>
                          <Badge variant="outline">{group.role_label}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {projects.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Proiecte
                    </h4>
                    <ul className="flex flex-col divide-y divide-border">
                      {projects.map((group) => (
                        <li
                          key={group.id}
                          className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className="size-3 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  group.color ?? 'var(--brand-red)',
                              }}
                              aria-hidden="true"
                            />
                            <span className="truncate text-sm font-semibold text-foreground">
                              {group.name}
                            </span>
                          </div>
                          <Badge variant="outline">{group.role_label}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {canJoinGroups && <JoiningSection />}
          </section>

          <PushDeviceCard />
        </div>
      </div>

      {/* Edit Profile Sheet */}
      <EditProfileSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        profile={profile}
      />
    </section>
  );
}
