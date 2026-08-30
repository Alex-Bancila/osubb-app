import type { EventPresentation } from '../../queries/events';
import type { Department } from '../../queries/reference';

export type EventDayGroup = {
  dayKey: string;
  dayLabel: string;
  events: EventPresentation[];
};

const EVENT_TYPE_LABELS: Record<EventPresentation['type'], string> = {
  sedinta: 'Ședință',
  activitate: 'Activitate',
  call: 'Call',
  eveniment: 'Eveniment',
  deadline: 'Deadline',
  recrutare: 'Recrutare',
};

export function groupUpcomingEvents(
  events: EventPresentation[],
): EventDayGroup[] {
  const groups = new Map<string, EventDayGroup>();
  const chronological = [...events].sort(
    (left, right) =>
      Date.parse(left.startsAt) - Date.parse(right.startsAt) ||
      left.id - right.id,
  );

  for (const event of chronological) {
    const group = groups.get(event.dayKey);
    if (group) {
      group.events.push(event);
      continue;
    }

    groups.set(event.dayKey, {
      dayKey: event.dayKey,
      dayLabel: event.dayLabel,
      events: [event],
    });
  }

  return [...groups.values()];
}

export function eventTypeLabel(type: EventPresentation['type']): string {
  return EVENT_TYPE_LABELS[type];
}

export function eventScopeLabel(
  event: EventPresentation,
  departments?: Map<string, Department>,
): string {
  if (event.scope === 'org') return 'OSUBB';
  if (event.scope === 'project') return 'Proiect';

  const department = event.departmentId
    ? departments?.get(event.departmentId)
    : undefined;

  if (event.scope === 'dept') return department?.name ?? 'Departament';
  return department ? `Echipă · ${department.name}` : 'Echipă';
}
