import type { Database } from './database.types';

export type DatabaseTask = Pick<
  Database['public']['Tables']['tasks']['Row'],
  | 'id'
  | 'title'
  | 'status'
  | 'type'
  | 'difficulty'
  | 'rating'
  | 'points'
  | 'deadline'
  | 'dept_id'
  | 'team_id'
>;

export interface PresentationTask {
  id: number;
  title: string;
  statusRaw: string;
  statusLabel: string;
  type: string;
  difficulty: number;
  rating: number | null;
  points: number | null;
  pointsLabel: string;
  deadlineRaw: string | null;
  deadlineLabel: string;
  deptId: string | null;
  teamId: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'De făcut',
  progress: 'În lucru',
  done: 'Finalizat',
  overdue: 'Întârziat',
  open: 'Deschis',
};

export function mapTask(task: DatabaseTask): PresentationTask {
  let deadlineLabel = 'Fără termen';
  if (task.deadline) {
    // Treat the PostgreSQL string as a local calendar date, ignoring UTC shifting
    const dateStr = task.deadline.split('T')[0];
    const [year, month, day] = dateStr.split('-').map(Number);
    // Construct local date at midnight
    const date = new Date(year, month - 1, day);
    
    deadlineLabel = new Intl.DateTimeFormat('ro-RO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  const statusLabel = STATUS_LABELS[task.status] || task.status;

  let pointsLabel = '-';
  if (task.points !== null) {
    pointsLabel = `${task.points} pct`;
  }

  return {
    id: task.id,
    title: task.title || 'Fără titlu', // Fallback for safety
    statusRaw: task.status,
    statusLabel,
    type: task.type || '',
    difficulty: task.difficulty,
    rating: task.rating,
    points: task.points,
    pointsLabel,
    deadlineRaw: task.deadline,
    deadlineLabel,
    deptId: task.dept_id,
    teamId: task.team_id,
  };
}
