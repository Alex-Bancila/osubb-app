import { useId, useState, type ReactNode } from 'react';
import { Panel } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import type { MemberIdentity } from '../../components/member/member-identity';
import { ErrorState, Loading } from '../../components/states';
import { commandErrorMessage } from '../../lib/command-reasons';
import { useCapabilities } from '../../lib/capabilities';
import {
  useDealsTeam,
  useSetDealsTeamMember,
  type DealsTeam,
  type TeamRole,
} from '../../queries/deals';
import {
  useAppointableMembers,
  type AppointableMember,
} from '../../queries/groups-admin';
import { useMemberIdentities } from '../../queries/member-identities';
import { MemberPicker } from '../administrare/MemberPicker';
import {
  coordinatorCandidates,
  responsibleCandidates,
  teamMemberIds,
} from './deals-presentation';

const ROLE_NAME: Record<TeamRole, string> = {
  coordinator: 'Coordonator',
  responsible: 'Responsabil',
};

type Outcome = {
  tone: 'status' | 'alert';
  text: string;
  /** The Member the receipt is about, named before the text. */
  member?: MemberIdentity;
};

/**
 * The OSUBB Deals team (ruling R44): the Atribuție's holder, then the
 * Coordonator — a BCE member, picked by the holder — and the Responsabil —
 * any active Member, picked by the holder or the Coordonator. The Moderator
 * picks both without being on the team (R44 amended 2026-10-08). Whoever may
 * not pick a place sees its name, and nobody picks while nobody holds the
 * Atribuție. Each pick takes effect at once: the server tells the person set
 * and the one replaced, and a receipt says it here.
 */
export function DealsTeamPanel() {
  const capabilities = useCapabilities().data;
  const team = useDealsTeam();
  // An Atribuție nobody holds has no team to pick (the server refuses too).
  const held = Boolean(team.data?.holderId);
  const pickCoordinator = held && capabilities?.pickDealsCoordinator === true;
  const pickResponsible = held && capabilities?.manageDealsTeam === true;
  const members = useAppointableMembers(pickCoordinator || pickResponsible);
  const names = useMemberIdentities(teamMemberIds(team.data));
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (team.isPending) return <Loading label="Se încarcă echipa…" />;
  if (team.isError)
    return (
      <ErrorState
        error={team.error}
        text="Nu am putut încărca echipa OSUBB Deals."
        onRetry={() => void team.refetch()}
      />
    );

  const nameOf = (id: string | null): MemberIdentity | null =>
    id
      ? (names.data?.get(id) ?? { memberId: id, fullName: 'Membru OSUBB' })
      : null;

  return (
    <Panel title="Echipa" stack={3}>
      <dl className="m-0 grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <TeamPlace label="Responsabil OSUBB Deals" hint="Atribuție BC">
          <PlaceName member={nameOf(team.data.holderId)} empty="Fără titular" />
        </TeamPlace>
        <TeamPlace label="Coordonator" hint="Membru BCE">
          {pickCoordinator ? (
            <TeamPicker
              role="coordinator"
              team={team.data}
              holder={nameOf(team.data.coordinatorId)}
              members={coordinatorCandidates(members.data ?? [], team.data)}
              loading={members.isPending}
              onOutcome={setOutcome}
            />
          ) : (
            <PlaceName
              member={nameOf(team.data.coordinatorId)}
              empty="Neales"
            />
          )}
        </TeamPlace>
        <TeamPlace label="Responsabil" hint="Orice membru activ">
          {pickResponsible ? (
            <TeamPicker
              role="responsible"
              team={team.data}
              holder={nameOf(team.data.responsibleId)}
              members={responsibleCandidates(members.data ?? [], team.data)}
              loading={members.isPending}
              onOutcome={setOutcome}
            />
          ) : (
            <PlaceName
              member={nameOf(team.data.responsibleId)}
              empty="Neales"
            />
          )}
        </TeamPlace>
      </dl>
      {outcome && (
        <p
          role={outcome.tone}
          className={
            outcome.tone === 'alert'
              ? 'm-0 text-sm text-destructive'
              : 'm-0 flex flex-wrap items-center gap-x-1 text-sm text-emerald-700 dark:text-emerald-400'
          }
        >
          {outcome.member && (
            <>
              <MemberName
                {...outcome.member}
                size="sm"
                className="text-sm"
              />{' '}
            </>
          )}
          {outcome.text}
        </p>
      )}
    </Panel>
  );
}

function TeamPlace({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <dt className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{label}</span> · {hint}
      </dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}

function PlaceName({
  member,
  empty,
}: {
  member: MemberIdentity | null;
  empty: string;
}) {
  if (!member)
    return <span className="text-sm text-muted-foreground">{empty}</span>;
  return <MemberName {...member} size="sm" />;
}

function TeamPicker({
  role,
  team,
  holder,
  members,
  loading,
  onOutcome,
}: {
  role: TeamRole;
  team: DealsTeam;
  /** Who holds the place now, from the names read: shown even when the
   *  candidates are still loading or no longer list them. */
  holder: MemberIdentity | null;
  members: AppointableMember[];
  loading: boolean;
  onOutcome: (outcome: Outcome | null) => void;
}) {
  const labelId = useId();
  const set = useSetDealsTeamMember();
  const currentId =
    role === 'coordinator' ? team.coordinatorId : team.responsibleId;
  const listed =
    members.find((member) => member.memberId === currentId) ?? null;
  // The place is taken even when the candidates do not list its holder.
  const current: AppointableMember | null =
    listed ??
    (currentId && holder
      ? {
          memberId: currentId,
          name: holder.fullName,
          nickname: holder.nickname,
          avatarColor: holder.avatarColor ?? null,
          status: 'activ',
          roleId: null,
          roleLabel: '',
          level: 0,
        }
      : null);
  const options = listed || !current ? members : [current, ...members];

  function choose(next: AppointableMember | null) {
    if ((next?.memberId ?? null) === currentId) return;
    onOutcome(null);
    set.mutate(
      { role, memberId: next?.memberId ?? null },
      {
        onSuccess: () =>
          onOutcome({
            tone: 'status',
            ...(next
              ? {
                  member: {
                    memberId: next.memberId,
                    nickname: next.nickname,
                    fullName: next.name,
                    avatarColor: next.avatarColor,
                  },
                  text: `este acum ${ROLE_NAME[role]} OSUBB Deals.`,
                }
              : { text: `Locul de ${ROLE_NAME[role]} este liber.` }),
          }),
        onError: (cause) =>
          onOutcome({
            tone: 'alert',
            text: commandErrorMessage(
              cause,
              'Nu am putut schimba echipa. Încearcă din nou.',
            ),
          }),
      },
    );
  }

  return (
    <>
      <span id={labelId} className="sr-only">
        Alege {ROLE_NAME[role]}
      </span>
      <MemberPicker
        ariaLabelledBy={labelId}
        members={options}
        value={current}
        onValueChange={choose}
        noneLabel={
          role === 'coordinator' ? 'Fără coordonator' : 'Fără responsabil'
        }
        disabled={loading || set.isPending}
      />
    </>
  );
}
