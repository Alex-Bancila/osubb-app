import { useState } from 'react';
import { Button } from '../../components/ui/button';
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
  const fieldId = `appoint-${groupRole}`;
  function reset() {
    setMember(null);
    setPositionTitle('');
    setAttempted(false);
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
      <Button
        type="button"
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
            onValueChange={setMember}
            disabled={busy}
          />
        </div>
        {withTitle && (
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Numele funcției</span>
            <input
              className={control}
              value={positionTitle}
              required
              maxLength={80}
              placeholder="Responsabil Logistică"
              disabled={busy}
              onChange={(event) => setPositionTitle(event.target.value)}
            />
          </label>
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
            disabled={busy || !member || (withTitle && !positionTitle.trim())}
            onClick={async () => {
              if (!member) return;
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

function PositionList({
  label,
  entries,
  group,
  canChange,
  busy,
  onWithdraw,
}: {
  label: string;
  entries: RosterEntry[];
  group: AdminGroup;
  canChange: boolean;
  busy: boolean;
  onWithdraw: (entry: RosterEntry) => void;
}) {
  if (!entries.length)
    return <p className="text-muted-foreground">Nimeni deocamdată.</p>;
  return (
    <ul className="space-y-2" aria-label={label}>
      {entries.map((entry) => (
        <li
          key={entry.memberId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
        >
          <span className="flex min-w-0 items-center gap-2">
            <MemberAvatar name={entry.name} avatarColor={entry.avatarColor} />
            <span className="grid min-w-0">
              <span className="truncate font-medium">{entry.name}</span>
              <span className="truncate text-sm text-muted-foreground">
                {groupRoleLabel(
                  entry.groupRole,
                  group.manager_title,
                  entry.positionTitle,
                )}
              </span>
            </span>
          </span>
          {canChange && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={`Retrage funcția lui ${entry.name}`}
              onClick={() => onWithdraw(entry)}
            >
              Retrage funcția
            </Button>
          )}
        </li>
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
    void onRun({
      kind: 'setRole',
      groupId: group.id,
      memberId: entry.memberId,
      groupRole: 'member',
      positionTitle: null,
    });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">
            {group.manager_title?.trim() || 'Coordonatori'}
          </h3>
          {authority.appointManager && (
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
          )}
        </div>
        <PositionList
          label="Coordonatorii grupului"
          entries={managers}
          group={group}
          canChange={authority.appointManager}
          busy={busy}
          onWithdraw={withdraw}
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Responsabili</h3>
          {authority.manageGroup && (
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
          )}
        </div>
        <PositionList
          label="Responsabilii grupului"
          entries={responsibles}
          group={group}
          canChange={authority.manageGroup}
          busy={busy}
          onWithdraw={withdraw}
        />
      </section>
    </div>
  );
}
