import { useId, useState } from 'react';
import {
  EmptyState,
  ListRow,
  PageGrid,
  Panel,
  rowListClass,
} from '../../components/layout';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
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
import { MemberPicker } from './MemberPicker';
import { groupRoleLabel } from './group-tree';

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
    setPositionTitle('');
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
              const next = {
                member: member ? undefined : 'Alege un membru.',
                title:
                  withTitle && !positionTitle.trim()
                    ? 'Scrie numele funcției.'
                    : undefined,
              };
              setMissing(next);
              if (!member || next.title) return;
              setAttempted(true);
              const done = await onAppoint(
                member.memberId,
                withTitle ? positionTitle : null,
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
  const withdraw = (entry: RosterEntry) =>
    onRun({
      kind: 'setRole',
      groupId: group.id,
      memberId: entry.memberId,
      groupRole: 'member',
      positionTitle: null,
    });

  // Two panels side by side from 768 px, each with its own appointment and
  // its rows flush in the box — no bordered row inside a bordered box
  // (layout AD5).
  return (
    <PageGrid columns={2} alignHeaders>
      <Panel
        title={group.manager_title?.trim() || 'Coordonatori'}
        flush={managers.length > 0}
        control={
          authority.appointManager && (
            <AppointDialog
              trigger="Numește un coordonator"
              title={`Coordonator pentru ${group.name}`}
              description="Coordonatorul conduce grupul și toate subgrupurile lui."
              groupRole="manager"
              withTitle={false}
              members={members}
              busy={busy}
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
        title="Responsabili"
        flush={responsibles.length > 0}
        control={
          authority.manageGroup && (
            <AppointDialog
              trigger="Numește un responsabil"
              title={`Responsabil în ${group.name}`}
              description="Responsabilul se ocupă de o parte din munca grupului, sub numele funcției pe care i-l dai."
              groupRole="responsible"
              withTitle
              members={members}
              busy={busy}
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
          label="Responsabilii grupului"
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
