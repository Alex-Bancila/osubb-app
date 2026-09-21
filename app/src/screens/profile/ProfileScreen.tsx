import { useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import {
  AlertTriangle,
  Calendar,
  History,
  Lock,
  Mail,
  Moon,
  Pencil,
  Phone,
  Shield,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';
import { formatLongDate, formatPoints, initials } from '../../lib/format';
import { useTheme } from '../../lib/theme';
import { useMyPoints, useMyStanding } from '../../queries/points';
import { useMyProfile } from '../../queries/profile';
import { useGroups, useRoles } from '../../queries/reference';
import EditProfileSheet from './EditProfileSheet';

export default function ProfileScreen() {
  const { claims } = useAuth();
  const leader = can(claims, 'seeLeadership');

  const profileQuery = useMyProfile();
  const pointsQuery = useMyPoints();
  const standingQuery = useMyStanding({ enabled: leader });
  const rolesQuery = useRoles();
  const groupsQuery = useGroups();

  const { theme, toggleTheme } = useTheme();

  const [editOpen, setEditOpen] = useState(false);
  const [resignModalOpen, setResignModalOpen] = useState(false);

  const isPending =
    profileQuery.isPending ||
    pointsQuery.isPending ||
    rolesQuery.isPending ||
    groupsQuery.isPending ||
    (leader && standingQuery.isPending);

  const isError =
    profileQuery.isError ||
    pointsQuery.isError ||
    (leader && standingQuery.isError);

  if (isError) {
    return (
      <IonPage>
        <IonContent>
          <div className="page">
            <ErrorState
              text="Nu am putut încărca profilul."
              error={
                profileQuery.error ?? pointsQuery.error ?? standingQuery.error
              }
              onRetry={() => {
                void profileQuery.refetch?.();
                void pointsQuery.refetch?.();
                if (leader) void standingQuery.refetch?.();
                void rolesQuery.refetch?.();
                void groupsQuery.refetch?.();
              }}
            />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  if (isPending) {
    return (
      <IonPage>
        <IonContent>
          <div className="page">
            <Loading label="Se încarcă profilul…" />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  const profile = profileQuery.data;
  if (!profile) {
    return (
      <IonPage>
        <IonContent>
          <div className="page">
            <Empty text="Nu am găsit date despre profilul tău." />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  const roleLabel =
    rolesQuery.data?.get(profile.role)?.name ?? profile.role;
  const isVotingMember = profile.role === 'vot' || claims?.member_role === 'vot';

  // Resolved groups
  const memberGroupIds = claims?.group_ids ?? [];
  const memberGroups = memberGroupIds
    .map((id) => groupsQuery.data?.get(id))
    .filter((g) => g !== undefined);

  const memberSinceLabel = profile.joined_at
    ? `Membru din ${formatLongDate(new Date(profile.joined_at))}`
    : profile.joined_year
      ? `Membru din ${profile.joined_year}`
      : 'Membru OSUBB';

  return (
    <IonPage>
      <IonContent>
        <div className="page pb-12">
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
                aria-label={
                  theme === 'dark' ? 'Temă luminoasă' : 'Temă întunecată'
                }
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
                      backgroundColor:
                        profile.avatar_color ?? 'var(--brand-red)',
                    }}
                    aria-hidden="true"
                  >
                    {initials(profile.full_name)}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:items-start">
                    <h2 className="text-xl font-bold text-foreground">
                      {profile.full_name}
                    </h2>
                    <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                      <span className="role-badge">
                        <span className="role-dot" aria-hidden="true" />
                        {roleLabel}
                      </span>
                      <Badge variant="outline">
                        {profile.status === 'activ' ? 'Activ' : profile.status}
                      </Badge>
                      {profile.tier && (
                        <span className="chip">{profile.tier}</span>
                      )}
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
                      Identificator de cont — modificabil doar de BC.
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
                  </div>
                </dl>
              </section>
            </div>

            {/* Right Column (Points, Groups, Role History, Governance) */}
            <div className="flex flex-col gap-6 lg:col-span-2">
              {/* Points Summary Card */}
              <section className="card p-6">
                <div className="card-head">
                  <h3 className="card-title flex items-center gap-2">
                    <Sparkles
                      className="size-5 text-primary"
                      aria-hidden="true"
                    />
                    <span>Punctajul meu</span>
                  </h3>
                </div>

                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="bignum text-foreground">
                    {formatPoints(pointsQuery.data)}
                  </span>
                  <span className="text-base font-semibold text-muted-foreground">
                    puncte
                  </span>
                </div>

                {/* Standing vs Informational Note */}
                <div className="mt-4 rounded-lg bg-muted/40 p-4 border border-border">
                  {!leader ? (
                    <p className="text-xs text-muted-foreground">
                      Clasamentul și Cupa Departamentelor sunt vizibile pentru
                      BCE și BC.
                    </p>
                  ) : standingQuery.data?.rank == null ? (
                    <p className="text-xs text-muted-foreground">
                      Nu ești în clasament.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold text-foreground">
                          #{standingQuery.data.rank}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          din {standingQuery.data.total} membri
                        </span>
                      </div>
                      <p className="text-xs font-medium text-primary">
                        {standingQuery.data.next
                          ? `${formatPoints(standingQuery.data.next.gap)} p până la locul ${standingQuery.data.next.rank}`
                          : 'Locul 1 🏆'}
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* My Groups Card */}
              <section className="card p-6">
                <div className="card-head">
                  <h3 className="card-title flex items-center gap-2">
                    <Users className="size-5 text-primary" aria-hidden="true" />
                    <span>Grupurile mele</span>
                  </h3>
                  <Badge variant="outline">{memberGroups.length}</Badge>
                </div>

                {memberGroups.length === 0 ? (
                  <Empty text="Nu faci parte din nicio echipă încă." />
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {memberGroups.map((group) => {
                      if (!group) return null;
                      const categoryLabel =
                        group.category === 'department'
                          ? 'Departament'
                          : group.category === 'team'
                            ? 'Echipă'
                            : group.category === 'project'
                              ? 'Proiect'
                              : 'Organizație';

                      return (
                        <li
                          key={group.id}
                          className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
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
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {group.name}
                              </p>
                              <span className="text-xs text-muted-foreground">
                                {categoryLabel}
                              </span>
                            </div>
                          </div>
                          {group.short && (
                            <Badge variant="outline" className="font-mono">
                              {group.short}
                            </Badge>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* Role History Section */}
              <section className="card p-6">
                <div className="card-head">
                  <h3 className="card-title flex items-center gap-2">
                    <History
                      className="size-5 text-primary"
                      aria-hidden="true"
                    />
                    <span>Istoric roluri</span>
                  </h3>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-3">
                      <Shield
                        className="size-5 text-primary"
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {roleLabel}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Rol curent activ
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">Activ</Badge>
                  </div>

                  <p className="text-xs text-muted-foreground italic">
                    Jurnalul detaliat al promovărilor și deciziilor de rol va fi
                    disponibil odată cu activarea motorului de audit (1.9b).
                  </p>
                </div>
              </section>

              {/* Governance / Demisie AG (P3) */}
              {isVotingMember && (
                <section className="card border-primary/20 bg-primary/5 p-6 dark:bg-primary/10">
                  <div className="card-head">
                    <h3 className="card-title flex items-center gap-2 text-foreground">
                      <Shield className="size-5 text-primary" aria-hidden="true" />
                      <span>Adunarea Generală (AG)</span>
                    </h3>
                  </div>

                  <p className="text-sm text-foreground">
                    Deții calitatea de membru cu drept de vot în Adunarea
                    Generală OSUBB.
                  </p>

                  <div className="mt-4 flex justify-end">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setResignModalOpen(true)}
                    >
                      Demisie din AG
                    </Button>
                  </div>
                </section>
              )}
            </div>
          </div>

          {/* Edit Profile Sheet */}
          <EditProfileSheet
            open={editOpen}
            onClose={() => setEditOpen(false)}
            profile={profile}
          />

          {/* Demisie AG Confirmation Dialog */}
          {resignModalOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="resign-dialog-title"
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div
                className="fixed inset-0 bg-black/50 transition-opacity"
                onClick={() => setResignModalOpen(false)}
              />
              <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
                <div className="flex items-center gap-3 text-destructive">
                  <AlertTriangle className="size-6" aria-hidden="true" />
                  <h3
                    id="resign-dialog-title"
                    className="text-lg font-bold text-foreground"
                  >
                    Demisie din Adunarea Generală
                  </h3>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Ești sigur că vrei să soliciți retragerea calității de membru cu
                  drept de vot? Această solicitare necesită aprobarea Biroului de
                  Conducere (P3 — funcționalitate în curs de dezvoltare).
                </p>
                <div className="mt-6 flex justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setResignModalOpen(false)}
                  >
                    Renunță
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => setResignModalOpen(false)}
                  >
                    Am înțeles
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
