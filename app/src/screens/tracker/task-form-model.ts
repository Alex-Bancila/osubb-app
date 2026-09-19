import { bucharestWallTimeToIso } from '../../lib/calendar-time';

export type ManagedWorkGroup = {
  id: number;
  name: string;
  path: number[];
  min_level: number;
  category: string;
};
export type TaskFormOptions = {
  groups: ManagedWorkGroup[];
  campaigns: { id: number; name: string; group_id: number }[];
  umbrellas: { id: number; title: string; group_id: number }[];
};
export type TaskDraft = {
  title: string;
  description: string | null;
  deadline: string | null;
  groupId: number;
  kind: 'task' | 'umbrella';
  parentTaskId: number | null;
  audience: 'local' | 'org' | null;
  assignmentMode: 'direct' | 'public' | null;
  executorId: string | null;
  campaignId: number | null;
};
export type TaskFormValues = {
  title: string;
  description: string;
  deadline: string;
  groupId: number | null;
  kind: 'task' | 'umbrella' | 'subtask';
  parentTaskId: number | null;
  audience: 'local' | 'org';
  assignmentMode: 'direct' | 'public';
  executorId: string | null;
  campaignId: number | null;
};

export function groupOptions(groups: ManagedWorkGroup[]) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  return groups
    .map((group) => ({
      ...group,
      label: group.path
        .map((id) => byId.get(id)?.name)
        .filter(Boolean)
        .join(' › '),
      depth: group.path.filter((id) => byId.has(id)).length - 1,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ro') || a.id - b.id);
}

export function originFor(values: TaskFormValues, options: TaskFormOptions) {
  const id =
    values.kind === 'subtask'
      ? options.umbrellas.find((parent) => parent.id === values.parentTaskId)
          ?.group_id
      : values.groupId;
  return options.groups.find((group) => group.id === id);
}

export function campaignsFor(
  origin: ManagedWorkGroup | undefined,
  options: TaskFormOptions,
) {
  return origin
    ? options.campaigns.filter((campaign) =>
        origin.path.includes(campaign.group_id),
      )
    : [];
}

export function taskDraft(
  values: TaskFormValues,
  options: TaskFormOptions,
): TaskDraft | string {
  if (!values.title.trim()) return 'Scrie titlul taskului.';
  if (
    values.kind === 'subtask' &&
    !options.umbrellas.some((parent) => parent.id === values.parentTaskId)
  )
    return 'Alege un task-umbrelă disponibil.';
  const origin = originFor(values, options);
  if (!origin) return 'Alege un grup pe care îl poți administra.';
  const deadline = values.deadline
    ? bucharestWallTimeToIso(values.deadline)
    : null;
  if ((values.kind !== 'umbrella' || values.deadline) && !deadline)
    return 'Alege un termen valid, în ora României.';
  const umbrella = values.kind === 'umbrella';
  if (
    !umbrella &&
    values.campaignId !== null &&
    !campaignsFor(origin, options).some(
      (campaign) => campaign.id === values.campaignId,
    )
  )
    return 'Campania nu mai este disponibilă pentru acest grup.';
  return {
    title: values.title.trim(),
    description: values.description.trim() || null,
    deadline,
    groupId: origin.id,
    kind: umbrella ? 'umbrella' : 'task',
    parentTaskId: values.kind === 'subtask' ? values.parentTaskId : null,
    audience: umbrella ? null : values.audience,
    assignmentMode: umbrella ? null : values.assignmentMode,
    executorId:
      !umbrella && values.assignmentMode === 'direct'
        ? values.executorId
        : null,
    campaignId: umbrella ? null : values.campaignId,
  };
}
