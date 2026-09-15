import { useId, useMemo, useState } from 'react';
import {
  DataTable,
  type DataTableColumn,
} from '../../components/data-table/DataTable';
import { Button } from '../../components/ui/button';
import type { TaskPresentation } from './task-presentation';

const originKey = (task: TaskPresentation) =>
  `${task.origin.kind}:${task.origin.id}`;

function taskColumns(
  onOpenTask?: (id: number) => void,
): DataTableColumn<TaskPresentation>[] {
  return [
    {
      id: 'overdue',
      accessorFn: (task) => Number(task.overdue),
      header: 'Termen depășit',
      cell: ({ row }) => (row.original.overdue ? 'Da' : 'Nu'),
    },
    {
      accessorKey: 'title',
      header: 'Task',
      cell: ({ row }) =>
        onOpenTask ? (
          <Button
            variant="link"
            className="min-h-11 min-w-11 whitespace-normal text-left text-foreground"
            onClick={() => onOpenTask(row.original.id)}
          >
            {row.original.title}
          </Button>
        ) : (
          row.original.title
        ),
    },
    {
      id: 'origin',
      accessorFn: (task) => task.origin.label,
      header: 'Origine',
    },
    {
      id: 'status',
      accessorFn: (task) => task.statusLabel,
      header: 'Stare',
      cell: ({ row }) => (
        <span>
          {row.original.statusLabel}
          {row.original.feedbackPending ? ' · Modificări cerute' : ''}
          {row.original.completedLate ? ' · Finalizat cu întârziere' : ''}
        </span>
      ),
    },
    {
      id: 'deadline',
      accessorFn: (task) =>
        task.deadline ? Date.parse(task.deadline) : Number.MAX_SAFE_INTEGER,
      header: 'Termen',
      cell: ({ row }) => row.original.deadlineLabel,
    },
    {
      id: 'campaign',
      accessorFn: (task) => task.campaign?.name ?? '—',
      header: 'Campanie',
    },
    {
      accessorKey: 'points',
      header: 'Puncte',
      cell: ({ row }) => row.original.points ?? '—',
    },
  ];
}

export function ManagerTaskTable({
  tasks,
  onOpenTask,
}: {
  tasks: TaskPresentation[];
  onOpenTask?: (id: number) => void;
}) {
  const id = useId();
  const [origin, setOrigin] = useState('');
  const [status, setStatus] = useState('');
  const [campaign, setCampaign] = useState('');
  const origins = new Map(
    tasks.map((task) => [originKey(task), task.origin.label]),
  );
  const campaigns = new Map(
    tasks.flatMap((task) =>
      task.campaign
        ? [[String(task.campaign.id), task.campaign.name] as const]
        : [],
    ),
  );
  const filtered = tasks.filter(
    (task) =>
      (!origin || originKey(task) === origin) &&
      (!campaign || String(task.campaign?.id) === campaign) &&
      (!status ||
        (status === 'overdue'
          ? task.overdue
          : status === 'feedback'
            ? task.feedbackPending
            : status === 'late'
              ? task.completedLate
              : task.status === status)),
  );
  const columns = useMemo(() => taskColumns(onOpenTask), [onOpenTask]);
  const selectClass =
    'min-h-11 max-w-full rounded-md border border-input bg-background px-3 text-foreground focus-visible:outline-2 focus-visible:outline-ring';
  return (
    <div className="min-w-0 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm" htmlFor={`${id}-origin`}>
          Origine
          <select
            id={`${id}-origin`}
            className={selectClass}
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
          >
            <option value="">Toate originile</option>
            {[...origins]
              .sort((a, b) => a[1].localeCompare(b[1], 'ro'))
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm" htmlFor={`${id}-status`}>
          Stare
          <select
            id={`${id}-status`}
            className={selectClass}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">Toate stările</option>
            {[
              ['todo', 'De făcut'],
              ['in_progress', 'În lucru'],
              ['in_review', 'În verificare'],
              ['completed', 'Finalizat'],
              ['unfulfilled', 'Nerealizat'],
              ['cancelled', 'Anulat'],
              ['overdue', 'Termen depășit'],
              ['feedback', 'Modificări cerute'],
              ['late', 'Finalizat cu întârziere'],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm" htmlFor={`${id}-campaign`}>
          Campanie
          <select
            id={`${id}-campaign`}
            className={selectClass}
            value={campaign}
            onChange={(event) => setCampaign(event.target.value)}
          >
            <option value="">Toate campaniile</option>
            {[...campaigns].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        filters={[{ columnId: 'title', label: 'Caută după titlu' }]}
        emptyTitle="Niciun task corespunde filtrelor."
        initialSorting={[{ id: 'deadline', desc: false }]}
        prioritySort={{ id: 'overdue', desc: true }}
        rowClassName={(task) => (task.overdue ? 'bg-destructive/5' : '')}
      />
    </div>
  );
}
