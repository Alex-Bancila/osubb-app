import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from 'cn';
import { ListRow, Panel, rowListClass } from '../../components/layout';
import { MemberName } from '../../components/member/MemberName';
import { memberDisplayName } from '../../components/member/member-identity';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ChoiceRow } from '../../components/ui/radio-group';
import { commandErrorMessage } from '../../lib/command-reasons';
import {
  ASSIGNMENTS,
  assignmentLabel,
  useAssignmentHolders,
  useSetBcAssignment,
  type SetBcAssignmentInput,
} from '../../queries/bc-assignments';
import {
  assignmentChange,
  bcMembers,
  type AssignmentChange,
} from './bc-assignments-view';
import {
  useAppointableMembers,
  type AppointableMember,
} from '../../queries/groups-admin';

type Outcome = { tone: 'status' | 'alert'; text: string };

function receiptFor(input: SetBcAssignmentInput, name: string): string {
  const label = assignmentLabel(input.assignment);
  if (!input.granted) return `${label}: atribuția a fost retrasă.`;
  return input.move
    ? `${label} a fost mutată la ${name}.`
    : `${name} are acum atribuția ${label}.`;
}

/**
 * Administrare › Administrare BC (ruling R44), the Moderator's alone: every
 * active BC member in one quiet list, each opening into their Atribuții as
 * checkboxes. An Atribuție has exactly one holder, so ticking one another
 * member holds asks to move it, and unticking asks before the team dissolves.
 */
export default function AdminBcTab() {
  const members = useAppointableMembers();
  const holders = useAssignmentHolders();
  const set = useSetBcAssignment();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    change: AssignmentChange;
    name: string;
  } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (members.isPending || holders.isPending)
    return <Loading label="Se încarcă membrii BC…" />;
  if (members.isError || holders.isError)
    return (
      <ErrorState
        error={members.error ?? holders.error}
        text="Nu am putut încărca membrii BC."
        onRetry={() => {
          void members.refetch();
          void holders.refetch();
        }}
      />
    );

  const bc = bcMembers(members.data);
  const holderMap = holders.data;
  const byId = new Map(members.data.map((member) => [member.memberId, member]));
  const nameOf = (memberId: string) => {
    const member = byId.get(memberId);
    return member
      ? memberDisplayName(member.nickname, member.name)
      : 'alt membru';
  };

  function run(change: AssignmentChange, name: string) {
    setOutcome(null);
    set.mutate(change.input, {
      onSuccess: () => {
        setPending(null);
        setOutcome({ tone: 'status', text: receiptFor(change.input, name) });
      },
      onError: (cause) => {
        setPending(null);
        setOutcome({
          tone: 'alert',
          text: commandErrorMessage(
            cause,
            'Nu am putut schimba atribuția. Încearcă din nou.',
          ),
        });
      },
    });
  }

  function toggle(
    member: AppointableMember,
    assignment: string,
    checked: boolean,
  ) {
    const change = assignmentChange(
      assignment,
      member,
      checked,
      holderMap,
      nameOf,
    );
    const name = memberDisplayName(member.nickname, member.name);
    if (change.confirm) setPending({ change, name });
    else run(change, name);
  }

  return (
    <>
      <Panel
        title="Membrii BC"
        description="Atribuțiile fiecărui membru BC. Fiecare atribuție are un singur titular."
        flush
      >
        {bc.length === 0 ? (
          <Empty bare text="Niciun membru BC activ." />
        ) : (
          <ul className={rowListClass} aria-label="Membrii BC">
            {bc.map((member) => {
              const held = ASSIGNMENTS.filter(
                (assignment) =>
                  holders.data.get(assignment.id) === member.memberId,
              );
              const open = openId === member.memberId;
              const panelId = `bc-assignments-${member.memberId}`;
              return (
                <ListRow
                  key={member.memberId}
                  className="px-4"
                  action={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 gap-1.5"
                      aria-expanded={open}
                      aria-controls={panelId}
                      aria-label={`Atribuțiile lui ${memberDisplayName(member.nickname, member.name)}`}
                      onClick={() => {
                        setOutcome(null);
                        setOpenId(open ? null : member.memberId);
                      }}
                    >
                      <span className="hidden sm:inline">Atribuții</span>
                      <ChevronDown
                        className={cn(
                          'size-4 transition-transform motion-reduce:transition-none',
                          open && 'rotate-180',
                        )}
                        aria-hidden="true"
                      />
                    </Button>
                  }
                  footer={
                    open ? (
                      <fieldset
                        id={panelId}
                        className="m-0 min-w-0 rounded-md border-0 bg-muted/50 px-3 py-2"
                        disabled={set.isPending}
                      >
                        <legend className="sr-only">
                          Atribuțiile lui{' '}
                          {memberDisplayName(member.nickname, member.name)}
                        </legend>
                        {ASSIGNMENTS.map((assignment) => {
                          const holder = holders.data.get(assignment.id);
                          const mine = holder === member.memberId;
                          return (
                            <ChoiceRow key={assignment.id}>
                              <Checkbox
                                checked={mine}
                                onCheckedChange={(next) =>
                                  toggle(member, assignment.id, next === true)
                                }
                              />
                              <span className="min-w-0">
                                <span className="font-medium">
                                  {assignment.label}
                                </span>
                                {holder && !mine && (
                                  <span className="block text-xs text-muted-foreground">
                                    Acum la {nameOf(holder)}
                                  </span>
                                )}
                              </span>
                            </ChoiceRow>
                          );
                        })}
                      </fieldset>
                    ) : undefined
                  }
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <MemberName
                      memberId={member.memberId}
                      nickname={member.nickname}
                      fullName={member.name}
                      avatarColor={member.avatarColor}
                      size="sm"
                    />
                    <span className="truncate text-xs text-muted-foreground">
                      {held.length === 0
                        ? 'Nicio atribuție'
                        : held.map((assignment) => assignment.label).join(', ')}
                    </span>
                  </div>
                </ListRow>
              );
            })}
          </ul>
        )}
      </Panel>
      {outcome && (
        <p
          role={outcome.tone}
          className={
            outcome.tone === 'alert'
              ? 'm-0 text-sm text-destructive'
              : 'm-0 text-sm text-emerald-700 dark:text-emerald-400'
          }
        >
          {outcome.text}
        </p>
      )}

      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (set.isPending) return;
          if (!next) setPending(null);
        }}
      >
        <DialogContent showCloseButton={!set.isPending}>
          {pending?.change.confirm && (
            <>
              <DialogHeader>
                <DialogTitle>{pending.change.confirm.title}</DialogTitle>
                <DialogDescription>
                  {pending.change.confirm.description}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={set.isPending}
                  onClick={() => setPending(null)}
                >
                  Renunță
                </Button>
                <Button
                  type="button"
                  variant={
                    pending.change.input.granted ? 'default' : 'destructive'
                  }
                  disabled={set.isPending}
                  onClick={() => run(pending.change, pending.name)}
                >
                  {set.isPending
                    ? 'Se salvează…'
                    : pending.change.confirm.action}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
