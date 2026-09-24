import { bucharestWallTimeToIso } from '../../lib/calendar-time';
import type { TaskDraftInput } from '../../lib/schemas/task';

export type ManagedWorkGroup = {
  id: number;
  name: string;
  path: number[];
  min_level: number;
};
export type TaskFormOptions = {
  groups: ManagedWorkGroup[];
  campaigns: { id: number; name: string; group_id: number }[];
  umbrellas: { id: number; title: string; group_id: number }[];
  /** Names of readable Groups, so a Child Group can be shown with its parent. */
  groupNames?: { id: number; name: string }[];
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

/** Managed Groups in tree order: parents first, siblings alphabetically. */
export function groupOptions(groups: ManagedWorkGroup[]) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const key = (group: ManagedWorkGroup) =>
    group.path.map((id) => byId.get(id)?.name ?? '');
  return [...groups].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
      const order = (left[i] ?? '').localeCompare(right[i] ?? '', 'ro');
      if (order) return order;
    }
    return left.length - right.length || a.id - b.id;
  });
}

/** Every Group name the form can show: managed Groups plus readable parents. */
export function groupLookup(options: TaskFormOptions) {
  const names = new Map<number, { name: string }>();
  for (const group of options.groupNames ?? []) names.set(group.id, group);
  for (const group of options.groups) names.set(group.id, group);
  return names;
}

/** Umbrellas a Subtask may join: only those whose Origin is the chosen Group. */
export function umbrellasFor(groupId: number | null, options: TaskFormOptions) {
  return groupId === null
    ? options.umbrellas
    : options.umbrellas.filter((parent) => parent.group_id === groupId);
}

/** A Subtask's Origin is its parent's Group; before a parent is chosen it is the Group picked so far. */
export function originFor(values: TaskFormValues, options: TaskFormOptions) {
  const id =
    values.kind === 'subtask' && values.parentTaskId !== null
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

/**
 * What the form's values say, in the shape `taskDraftSchema` checks: the
 * Origin a Subtask inherits, the deadline read in Romania (`''` when that
 * wall-clock time does not exist), and no assignment fields on an Umbrella.
 * Nothing is judged here; the schema does that.
 */
export function taskDraftInput(
  values: TaskFormValues,
  options: TaskFormOptions,
): TaskDraftInput {
  const origin = originFor(values, options);
  const umbrella = values.kind === 'umbrella';
  // Send what the form shows: a Campaign that is no longer offered for this
  // Origin (the options were refreshed) is displayed as none, so it is none.
  const campaignId = campaignsFor(origin, options).some(
    (campaign) => campaign.id === values.campaignId,
  )
    ? values.campaignId
    : null;
  return {
    title: values.title,
    description: values.description,
    deadline: values.deadline
      ? (bucharestWallTimeToIso(values.deadline) ?? '')
      : null,
    groupId: origin?.id ?? values.groupId ?? 0,
    kind: values.kind,
    parentTaskId: values.kind === 'subtask' ? values.parentTaskId : null,
    audience: umbrella ? null : values.audience,
    assignmentMode: umbrella ? null : values.assignmentMode,
    executorId:
      !umbrella && values.assignmentMode === 'direct'
        ? values.executorId
        : null,
    campaignId: umbrella ? null : campaignId,
  };
}
