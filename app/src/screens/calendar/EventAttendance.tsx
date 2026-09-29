import { useId, useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown } from 'lucide-react';

import { MemberName } from '../../components/member/MemberName';
import {
  memberDisplayName,
  type MemberIdentity,
} from '../../components/member/member-identity';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
import { cn } from '../../lib/utils';
import {
  attendanceTally,
  useEventAttendance,
  type EventAttendance as Attendance,
} from '../../queries/event-attendance';
import { useEventFormOptions } from '../../queries/event-creation';
import { managesEvent } from '../../queries/event-edit';
import type { EventPresentation } from '../../queries/events';
import { useMemberIdentities } from '../../queries/member-identities';

/**
 * The answers on this Event, for its managers only (#934): the counts on the
 * card, and **Cine participă** — every Member who answered, grouped Particip /
 * Nu particip. Everyone else sees nothing here; the server's
 * `event_attendance_read` would show them only their own answer anyway.
 */
export function EventAttendance({ event }: { event: EventPresentation }) {
  const { session } = useAuth();
  const capabilities = useCapabilities();
  const options = useEventFormOptions();
  const manager =
    capabilities.data !== undefined &&
    options.data !== undefined &&
    managesEvent(event, {
      memberId: session?.user.id,
      capabilities: capabilities.data,
      options: options.data,
    });
  const attendance = useEventAttendance(event.id, manager);
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (!manager) return null;

  const answers = attendance.data;
  const total = answers ? answers.going.length + answers.declined.length : 0;

  return (
    <section className="event-attendance" aria-label="Răspunsurile membrilor">
      <div className="event-attendance-head">
        {answers && total > 0 ? (
          <Button
            type="button"
            variant="ghost"
            className="event-attendance-toggle"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((current) => !current)}
          >
            Cine participă
            <ChevronDown
              className={cn(
                'size-4 transition-transform motion-reduce:transition-none',
                open && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </Button>
        ) : (
          <p className="event-attendance-label">Cine participă</p>
        )}
        <p className="event-attendance-tally" role="status">
          {answers
            ? total > 0
              ? attendanceTally(answers)
              : 'Niciun răspuns încă'
            : attendance.isError
              ? 'Răspunsurile nu s-au încărcat.'
              : 'Se încarcă răspunsurile…'}
        </p>
      </div>

      {attendance.isError && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => void attendance.refetch()}
        >
          Reîncearcă
        </Button>
      )}

      {answers && total > 0 && (
        <div
          className="event-attendance-bar"
          aria-hidden="true"
          style={
            {
              '--going-share': `${(answers.going.length / total) * 100}%`,
            } as CSSProperties
          }
        />
      )}

      {answers && open && <AttendanceList id={listId} answers={answers} />}
    </section>
  );
}

function AttendanceList({ id, answers }: { id: string; answers: Attendance }) {
  const ids = useMemo(() => [...answers.going, ...answers.declined], [answers]);
  const identities = useMemberIdentities(ids);

  if (identities.isPending)
    return (
      <p id={id} className="event-attendance-note" role="status">
        Se încarcă numele…
      </p>
    );

  const known = identities.data ?? new Map<string, MemberIdentity>();
  const named = (memberIds: readonly string[]) =>
    memberIds
      .map(
        (memberId) =>
          known.get(memberId) ?? { memberId, fullName: 'Membru OSUBB' },
      )
      .sort((a, b) =>
        memberDisplayName(a.nickname, a.fullName).localeCompare(
          memberDisplayName(b.nickname, b.fullName),
          'ro',
        ),
      );

  return (
    <div id={id} className="event-attendance-groups">
      <AttendanceGroup
        label="Particip"
        tone="going"
        members={named(answers.going)}
      />
      <AttendanceGroup
        label="Nu particip"
        tone="declined"
        members={named(answers.declined)}
      />
    </div>
  );
}

function AttendanceGroup({
  label,
  tone,
  members,
}: {
  label: string;
  tone: 'going' | 'declined';
  members: MemberIdentity[];
}) {
  const headingId = useId();
  return (
    <section
      className={cn('event-attendance-group', `is-${tone}`)}
      aria-labelledby={headingId}
    >
      <h4 id={headingId} className="event-attendance-group-head">
        {label} <span className="event-attendance-count">{members.length}</span>
      </h4>
      {members.length === 0 ? (
        <p className="event-attendance-note">Nimeni.</p>
      ) : (
        <ul className="event-attendance-names">
          {members.map((member) => (
            <li key={member.memberId}>
              <MemberName {...member} size="sm" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
