import {
  businessOutline,
  ellipseOutline,
  globeOutline,
  peopleOutline,
  rocketOutline,
} from 'ionicons/icons';

import type { EventPresentation } from '../../queries/events';
import type { Group } from '../../queries/reference';

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

/**
 * `groups.category` is a presentation label and nothing else (ADR-0009) — which
 * is exactly what an icon is. No rule may branch on it; this map is allowed to.
 */
const GROUP_CATEGORY_ICONS: Record<string, string> = {
  organization: globeOutline,
  department: businessOutline,
  team: peopleOutline,
  project: rocketOutline,
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

/** The icon beside an Event's Group, chosen by the Group's category. */
export function eventGroupIcon(event: EventPresentation): string {
  if (!event.group) return ellipseOutline;
  return GROUP_CATEGORY_ICONS[event.group.category] ?? ellipseOutline;
}

/**
 * The card's accent: the nearest ancestor-or-self Group that has a colour.
 *
 * Only Departments and the Organization carry one. `groups.color` is mirrored
 * from `departments.color` (Brand Book 2025) and `teams`/`projects` have no
 * colour column at all, so every Team and Project Group is `null` — walking up
 * is what keeps a Department Team's card in its Department's colour, exactly as
 * it was when this card read `departments[event.dept_id]`.
 *
 * `path` is root-first and ends in the Group's own id, so walking it backwards
 * is "nearest ancestor first". The Group's own colour is read off the embedded
 * row rather than out of `groups`, because the embed is what the Event carries.
 */
export function eventAccentColor(
  event: EventPresentation,
  groups?: Map<number, Group>,
): string {
  const group = event.group;
  if (!group) return 'var(--ink-400)';
  if (group.color) return group.color;

  for (let index = group.path.length - 2; index >= 0; index -= 1) {
    const ancestorId = group.path[index];
    const ancestor =
      ancestorId === undefined ? undefined : groups?.get(ancestorId);
    if (ancestor?.color) return ancestor.color;
  }

  // Nothing on the chain has one. The Organization keeps its token so a native
  // Organization Group created without a colour is still OSUBB red.
  return group.is_organization ? 'var(--scope-org)' : 'var(--ink-400)';
}

/**
 * Who an Event belongs to, in the words a member uses.
 *
 * Three things decide it, all of them on the Group itself:
 *
 *  * `is_organization` — the one Group that *is* OSUBB says so, rather than the
 *    calendar recognising it by name or by a legacy id;
 *  * the ancestor `path` — a Group with a parent is somebody's Child Group, so a
 *    Department Team reads "Echipă · Educațional" while an Independent Team,
 *    which has no parent, is just "Echipă";
 *  * `category`, for the noun.
 *
 * `groups` is the Groups this member may read; it is needed only to name the
 * parent of a Child Group.
 */
export function eventGroupLabel(
  event: EventPresentation,
  groups?: Map<number, Group>,
): string {
  const group = event.group;
  // Either the Event names no Group at all, or it names one RLS withholds (an
  // archived Project's, say). Neither is worth an id on screen.
  if (!group) return 'Grup';

  if (group.is_organization) return 'OSUBB';

  if (group.category === 'team') {
    const parentId =
      group.path.length > 1 ? group.path[group.path.length - 2] : undefined;
    const parent = parentId === undefined ? undefined : groups?.get(parentId);
    return parent ? `Echipă · ${parent.name}` : 'Echipă';
  }

  if (group.category === 'project') return 'Proiect';

  return group.name;
}
