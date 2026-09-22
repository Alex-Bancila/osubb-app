import type { TaskDraft, TaskFormOptions } from './task-form-model';

type DraftInput = Record<keyof TaskDraft, unknown>;
const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Validate against a fresh server-authorized read; the command remains authoritative. */
export function validateTaskDraft(
  draft: DraftInput,
  options: TaskFormOptions,
): string | null {
  if (!isId(draft.groupId)) return 'Alege exact un grup de origine.';
  const group = options.groups.find(
    (candidate) => candidate.id === draft.groupId,
  );
  if (!group)
    return 'Nu mai poți pregăti taskuri pentru grupul ales. Alege un grup disponibil.';
  if (draft.kind !== 'task' && draft.kind !== 'umbrella')
    return 'Alege un tip de task valid.';
  if (typeof draft.title !== 'string' || !draft.title.trim())
    return 'Scrie titlul taskului.';
  if (
    draft.deadline !== null &&
    (typeof draft.deadline !== 'string' ||
      !Number.isFinite(Date.parse(draft.deadline)))
  )
    return 'Alege un termen valid, în ora României.';
  if (draft.parentTaskId !== null) {
    if (draft.kind === 'umbrella')
      return 'Un task-umbrelă nu poate fi Subtask.';
    const parent = isId(draft.parentTaskId)
      ? options.umbrellas.find(
          (candidate) => candidate.id === draft.parentTaskId,
        )
      : undefined;
    if (!parent)
      return 'Taskul-umbrelă nu mai este disponibil. Alege alt părinte.';
    if (parent.group_id !== draft.groupId)
      return 'Subtaskul trebuie să păstreze grupul de origine al taskului-umbrelă.';
  }
  if (draft.kind === 'umbrella') {
    return draft.audience !== null ||
      draft.assignmentMode !== null ||
      draft.executorId !== null ||
      draft.campaignId !== null
      ? 'Taskul-umbrelă nu are audiență, mod de atribuire, Executor sau campanie.'
      : null;
  }
  if (draft.deadline === null) return 'Alege termenul taskului.';
  if (draft.audience !== 'local' && draft.audience !== 'org')
    return 'Alege audiența: grupul de origine sau toți membrii eligibili OSUBB.';
  if (draft.assignmentMode !== 'direct' && draft.assignmentMode !== 'public')
    return 'Alege atribuirea directă sau publică.';
  if (
    draft.executorId !== null &&
    (typeof draft.executorId !== 'string' || !draft.executorId.trim())
  )
    return 'Alege un Executor valid sau lasă atribuirea pentru mai târziu.';
  if (draft.assignmentMode === 'public' && draft.executorId !== null)
    return 'Un task public primește Executor prin lista de candidați.';
  if (draft.campaignId !== null) {
    const campaign = isId(draft.campaignId)
      ? options.campaigns.find((candidate) => candidate.id === draft.campaignId)
      : undefined;
    if (!campaign || !group.path.includes(campaign.group_id))
      return 'Alege o campanie activă a grupului de origine sau a unui grup părinte.';
  }
  return null;
}

const commandErrors: Record<string, string> = {
  parent_not_umbrella: 'Alege un task-umbrelă valid pentru Subtask.',
  parent_terminal: 'Taskul-umbrelă s-a schimbat. Alege un părinte nefinalizat.',
  task_not_found: 'Grupul sau taskul-umbrelă nu mai este disponibil.',
  task_command_forbidden:
    'Nu mai ai permisiunea de a crea taskuri în acest grup.',
  task_manage_forbidden:
    'Nu mai ai permisiunea de a crea taskuri în acest grup.',
  invalid_executor: 'Executorul nu mai este eligibil pentru grupul ales.',
  title_required: 'Scrie titlul taskului.',
  deadline_required: 'Alege termenul taskului.',
  task_group_required: 'Alege exact un grup de origine.',
  invalid_audience: 'Alege o audiență validă pentru task.',
  invalid_assignment_mode: 'Alege atribuirea directă sau publică.',
  invalid_task_kind: 'Alege un tip de task valid.',
  invalid_campaign: 'Campania nu mai este disponibilă pentru grupul ales.',
  subtask_origin_mismatch:
    'Subtaskul trebuie să păstreze grupul taskului-umbrelă.',
  subtask_cannot_be_umbrella: 'Un task-umbrelă nu poate fi Subtask.',
  umbrella_has_no_mode:
    'Taskul-umbrelă nu are audiență, mod de atribuire, Executor sau campanie.',
  executor_not_allowed_for_public:
    'Un task public primește Executor prin lista de candidați.',
};

/** Only stable, allowlisted command reasons become user-facing copy. */
export function taskDraftErrorMessage(error: unknown): string {
  const fallback = 'Nu am putut pregăti taskul. Încearcă din nou.';
  if (typeof error !== 'object' || error === null) return fallback;
  const reason = 'message' in error ? error.message : undefined;
  return typeof reason === 'string' && Object.hasOwn(commandErrors, reason)
    ? (commandErrors[reason] ?? fallback)
    : fallback;
}
