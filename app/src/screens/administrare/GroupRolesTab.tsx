import { useId, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  EmptyState,
  ListRow,
  PageGrid,
  Panel,
  rowListClass,
} from '../../components/layout';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import { reasonCopy } from '../../lib/command-reasons';
import { appointmentSchema } from '../../lib/schemas/group';
import { MemberAvatar } from '../../components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import type {
  AdminGroup,
  AppointableMember,
  GroupAuthority,
  GroupCommand,
  GroupRole,
  RosterEntry,
} from '../../queries/groups-admin';
import { useAuth } from '../../lib/auth';
import { fetchGroupCoordination } from '../../queries/group-applications';
import { useOrgSettings } from '../../queries/org-settings';
import { MemberPicker } from './MemberPicker';
import {
  groupRoleLabel,
  isBoardGroup,
  positionCandidates,
  positionNoun,
} from './group-tree';

/**
 * The Members holding a position in a Group above this one: theirs flows
 * down (ADR-0009), so they are no one to appoint here. An ancestor the
 * viewer cannot read adds nobody; the server still decides. Until every
 * ancestor has answered, `ready` is false and nothing is offered — an
 * unanswered lookup is not an empty one.
 */
function useInheritedHolders(group: AdminGroup): {
  ids: string[];
  ready: boolean;
  failed: boolean;
} {
  const viewer = useAuth().session?.user.id;
  const ancestors = group.path.filter((id) => id !== group.id);
  const results = useQueries({
    queries: ancestors.map((groupId) => ({
      // The key of useGroupCoordination, so a Group page's read is reused.
      queryKey: ['groups', 'coordination', { memberId: viewer, groupId }],
      queryFn: () => fetchGroupCoordination(groupId),
      enabled: Boolean(viewer),
    })),
  });
  // Manager and Responsible both flow down the path (private.group_role_of).
  return {
    ids: results.flatMap((result) =>
      (result.data ?? []).map((row) => row.memberId),
    ),
    ready: results.every((result) => result.isSuccess),
    failed: results.some((result) => result.isError),
  };
}

const control =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

/**
 * Appointing someone into a position, in a pop-up. A Group Responsible is
 * always shown under a display name of their own (ADR-0009 §Group Roles), so
 * the name is part of the appointment, not an afterthought.
 */
function AppointDialog({
  trigger,
  title,
  description,
  groupRole,
  withTitle,
  defaultTitle = '',
  members,
  busy,
  error,
  onAppoint,
}: {
  trigger: string;
  title: string;
  description: string;
  groupRole: GroupRole;
  withTitle: boolean;
  /** What "Numele funcției" opens with: the Group's name for the position (#962). */
  defaultTitle?: string;
  members: AppointableMember[];
  busy: boolean;
  error: string | null;
  onAppoint: (
    memberId: string,
    positionTitle: string | null,
  ) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState<AppointableMember | null>(null);
  const [positionTitle, setPositionTitle] = useState('');
  const [attempted, setAttempted] = useState(false);
  // What is missing, in Romanian, never the browser's tooltip (Audit D-16).
  const [missing, setMissing] = useState<{
    member?: string;
    title?: string;
  }>({});
  const fieldId = `appoint-${groupRole}`;
  const titleErrorId = useId();
  function reset() {
    setMember(null);
    setPositionTitle(defaultTitle);
    setAttempted(false);
    setMissing({});
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) reset();
      }}
    >
      {/* Outline: a panel of positions has no primary action (layout AD5). */}
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {trigger}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <span id={fieldId} className="text-sm font-medium">
            Membru
          </span>
          <MemberPicker
            ariaLabelledBy={fieldId}
            members={members}
            value={member}
            onValueChange={(next) => {
              setMember(next);
              setMissing((current) => ({ ...current, member: undefined }));
            }}
            disabled={busy}
          />
          <FieldError>{missing.member}</FieldError>
        </div>
        {withTitle && (
          <div className="grid gap-1.5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Numele funcției</span>
              <input
                className={control}
                value={positionTitle}
                maxLength={80}
                placeholder="Responsabil Logistică"
                disabled={busy}
                aria-invalid={missing.title ? true : undefined}
                aria-describedby={missing.title ? titleErrorId : undefined}
                onChange={(event) => {
                  setPositionTitle(event.target.value);
                  setMissing((current) => ({ ...current, title: undefined }));
                }}
              />
            </label>
            <FieldError id={titleErrorId}>{missing.title}</FieldError>
          </div>
        )}
        {attempted && error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Renunță
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              const parsed = appointmentSchema(withTitle).safeParse({
                memberId: member?.memberId ?? null,
                positionTitle,
              });
              const issue = (field: string) =>
                reasonCopy(
                  parsed.error?.issues.find((item) => item.path[0] === field)
                    ?.message,
                );
              setMissing({
                member: issue('memberId'),
                title: issue('positionTitle'),
              });
              if (!parsed.success || !member) return;
              setAttempted(true);
              const done = await onAppoint(
                member.memberId,
                parsed.data.positionTitle,
              );
              if (done) setOpen(false);
            }}
          >
            Numește
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Withdrawing a position asks first, like "Scoate" (Audit D-16). */
function WithdrawDialog({
  entry,
  group,
  busy,
  error,
  onWithdraw,
}: {
  entry: RosterEntry;
  group: AdminGroup;
  busy: boolean;
  error: string | null;
  onWithdraw: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const role = groupRoleLabel(
    entry.groupRole,
    group.manager_title,
    entry.positionTitle,
    group.responsible_title,
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) setAttempted(false);
      }}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        aria-label={`Retrage funcția lui ${entry.name}`}
        onClick={() => {
          setAttempted(false);
          setOpen(true);
        }}
      >
        Retrage funcția
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retragi funcția lui {entry.name}?</DialogTitle>
          <DialogDescription>
            {entry.name} nu va mai fi {role} în {group.name}, dar rămâne membru
            al grupului.
          </DialogDescription>
        </DialogHeader>
        {attempted && error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Renunță
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setAttempted(true);
              if (await onWithdraw()) setOpen(false);
            }}
          >
            Retrage funcția
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PositionList({
  label,
  entries,
  group,
  canChange,
  busy,
  error,
  onWithdraw,
}: {
  label: string;
  entries: RosterEntry[];
  group: AdminGroup;
  canChange: boolean;
  busy: boolean;
  error: string | null;
  onWithdraw: (entry: RosterEntry) => Promise<boolean>;
}) {
  if (!entries.length) return <EmptyState>Nimeni deocamdată.</EmptyState>;
  return (
    <ul className={rowListClass} aria-label={label}>
      {entries.map((entry) => (
        <ListRow
          key={entry.memberId}
          leading={
            <MemberAvatar name={entry.name} avatarColor={entry.avatarColor} />
          }
          action={
            canChange && (
              <WithdrawDialog
                entry={entry}
                group={group}
                busy={busy}
                error={error}
                onWithdraw={() => onWithdraw(entry)}
              />
            )
          }
        >
          <p className="m-0 truncate font-medium">{entry.name}</p>
          <p className="m-0 truncate text-sm text-muted-foreground">
            {groupRoleLabel(
              entry.groupRole,
              group.manager_title,
              entry.positionTitle,
              group.responsible_title,
            )}
          </p>
        </ListRow>
      ))}
    </ul>
  );
}

/**
 * The Group's positions. A Group Manager is decided one level up — BC and the
 * Moderator appoint a top-level Group's, the parent's Managers a Child
 * Group's — while a Group Manager appoints the Group's Responsibles.
 */
export function GroupRolesTab({
  group,
  roster,
  members,
  authority,
  busy,
  error,
  onRun,
}: {
  group: AdminGroup;
  roster: RosterEntry[];
  members: AppointableMember[];
  authority: GroupAuthority;
  busy: boolean;
  error: string | null;
  onRun: (command: GroupCommand) => Promise<boolean>;
}) {
  const managers = roster.filter((entry) => entry.groupRole === 'manager');
  const responsibles = roster.filter(
    (entry) => entry.groupRole === 'responsible',
  );
  const inherited = useInheritedHolders(group);
  const holders = new Set([
    ...inherited.ids,
    ...[...managers, ...responsibles].map((entry) => entry.memberId),
  ]);
  // #963: on the board Group a Responsible title is a Board Title, a BC
  // member's included. Unknown until the settings answer: #957 holds then.
  const settings = useOrgSettings();
  const boardGroup = isBoardGroup(
    group.id,
    settings.data?.get('board_group_id'),
  );
  // Two lists, not one (#957): BC may be a Coordonator, never a Responsabil
  // — except on the board Group.
  const managerCandidates = positionCandidates(
    members,
    group,
    holders,
    'manager',
  );
  const responsibleCandidates = positionCandidates(
    members,
    group,
    holders,
    'responsible',
    { boardGroup },
  );
  // No appointment while the positions above are unknown (see above).
  const appointBusy = busy || !inherited.ready;
  const lookupFailed = inherited.failed
    ? 'Nu am putut verifica funcțiile din grupurile de deasupra. Reîncarcă pagina ca să numești pe cineva.'
    : undefined;
  const withdraw = (entry: RosterEntry) =>
    onRun({
      kind: 'setRole',
      groupId: group.id,
      memberId: entry.memberId,
      groupRole: 'member',
      positionTitle: null,
    });
  // Each position under the name the Group's settings give it (#962), so a
  // Department's "Vicepreședinte" and its "Coordonator" responsibles never
  // share one button label; without a setting, the words stay as they were.
  const managerName = group.manager_title?.trim() || null;
  const responsibleName = group.responsible_title?.trim() || null;

  // Two panels side by side from 768 px, each with its own appointment and
  // its rows flush in the box — no bordered row inside a bordered box
  // (layout AD5).
  return (
    <PageGrid columns={2} alignHeaders>
      <Panel
        title={managerName ?? 'Coordonatori'}
        description={authority.appointManager ? lookupFailed : undefined}
        flush={managers.length > 0}
        control={
          authority.appointManager && (
            <AppointDialog
              trigger={`Numește un ${positionNoun(managerName ?? 'Coordonator')}`}
              title={`${managerName ?? 'Coordonator'} pentru ${group.name}`}
              description={
                managerName
                  ? `Un ${positionNoun(managerName)} conduce grupul și toate subgrupurile lui.`
                  : 'Coordonatorul conduce grupul și toate subgrupurile lui.'
              }
              groupRole="manager"
              withTitle={false}
              members={managerCandidates}
              busy={appointBusy}
              error={error}
              onAppoint={(memberId) =>
                onRun({
                  kind: 'setRole',
                  groupId: group.id,
                  memberId,
                  groupRole: 'manager',
                  positionTitle: null,
                })
              }
            />
          )
        }
      >
        <PositionList
          label="Coordonatorii grupului"
          entries={managers}
          group={group}
          canChange={authority.appointManager}
          busy={busy}
          error={error}
          onWithdraw={withdraw}
        />
      </Panel>

      <Panel
        title={responsibleName ?? 'Responsabili'}
        description={authority.manageGroup ? lookupFailed : undefined}
        flush={responsibles.length > 0}
        control={
          authority.manageGroup && (
            <AppointDialog
              trigger={`Numește un ${positionNoun(responsibleName ?? 'Responsabil')}`}
              title={`${responsibleName ?? 'Responsabil'} în ${group.name}`}
              description={
                responsibleName
                  ? `Un ${positionNoun(responsibleName)} se ocupă de o parte din munca grupului, sub numele funcției pe care i-l dai.`
                  : 'Responsabilul se ocupă de o parte din munca grupului, sub numele funcției pe care i-l dai.'
              }
              groupRole="responsible"
              withTitle
              defaultTitle={responsibleName ?? ''}
              members={responsibleCandidates}
              busy={appointBusy}
              error={error}
              onAppoint={(memberId, positionTitle) =>
                onRun({
                  kind: 'setRole',
                  groupId: group.id,
                  memberId,
                  groupRole: 'responsible',
                  positionTitle,
                })
              }
            />
          )
        }
      >
        <PositionList
          label={responsibleName ?? 'Responsabilii grupului'}
          entries={responsibles}
          group={group}
          canChange={authority.manageGroup}
          busy={busy}
          error={error}
          onWithdraw={withdraw}
        />
      </Panel>
    </PageGrid>
  );
}
