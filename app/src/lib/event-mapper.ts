import type { Database } from './database.types';

export type DatabaseEvent = Pick<
  Database['public']['Tables']['events']['Row'],
  | 'id'
  | 'title'
  | 'type'
  | 'scope'
  | 'capacity'
  | 'description'
  | 'location'
  | 'starts_at'
  | 'ends_at'
  | 'dept_id'
  | 'team_id'
  | 'created_by'
  | 'has_qr'
>;

export interface PresentationEvent {
  id: number;
  title: string;
  typeRaw: string;
  typeLabel: string;
  scopeRaw: string;
  scopeLabel: string;
  location: string | null;
  startDate: Date | null;
  endDate: Date | null;
  timeRangeLabel: string;
}

export interface EventGroup {
  dateLabel: string;
  events: PresentationEvent[];
}

const TYPE_LABELS: Record<string, string> = {
  sedinta: 'Ședință',
  activitate: 'Activitate',
  call: 'Call',
  eveniment: 'Eveniment',
  deadline: 'Deadline',
  recrutare: 'Recrutare',
};

const SCOPE_LABELS: Record<string, string> = {
  org: 'OSUBB',
  dept: 'Departament',
  project: 'Proiect',
  team: 'Echipă',
};

export function mapEvent(event: DatabaseEvent): PresentationEvent {
  const typeLabel = TYPE_LABELS[event.type] || event.type;
  const scopeLabel = SCOPE_LABELS[event.scope] || event.scope;
  
  let startDate = null;
  let endDate = null;
  let timeRangeLabel = 'Timp nespecificat';

  if (event.starts_at) {
    startDate = new Date(event.starts_at);
  }
  if (event.ends_at) {
    endDate = new Date(event.ends_at);
  }

  // Format time (e.g. 18:00 - 20:00)
  if (startDate) {
    const startStr = new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit' }).format(startDate);
    if (endDate) {
      const endStr = new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit' }).format(endDate);
      timeRangeLabel = `${startStr} - ${endStr}`;
    } else {
      timeRangeLabel = startStr;
    }
  }

  return {
    id: event.id,
    title: event.title || 'Fără titlu',
    typeRaw: event.type,
    typeLabel,
    scopeRaw: event.scope,
    scopeLabel,
    location: event.location,
    startDate,
    endDate,
    timeRangeLabel,
  };
}

export function groupEventsByDay(events: PresentationEvent[]): EventGroup[] {
  const groups: Record<string, EventGroup> = {};

  for (const event of events) {
    let dateStr = 'Dată necunoscută';
    if (event.startDate) {
      dateStr = new Intl.DateTimeFormat('ro-RO', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      }).format(event.startDate);
      // Capitalize first letter of the weekday
      dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    }

    if (!groups[dateStr]) {
      groups[dateStr] = {
        dateLabel: dateStr,
        events: []
      };
    }
    groups[dateStr].events.push(event);
  }

  return Object.values(groups);
}
