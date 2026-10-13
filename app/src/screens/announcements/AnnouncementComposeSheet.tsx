import { Toast } from '../../components/ui/toast';
import { useId, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { FabAction } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { FieldError } from '../../components/ui/field';
import { Select } from '../../components/ui/select';
import { FormSheet, FormSheetFooter } from '../../components/ui/form-sheet';
import { ChoiceRow } from '../../components/ui/radio-group';
import { SegmentedRadio } from '../../components/ui/segmented-radio';
import { useAuth } from '../../lib/auth';
import { bucharestWallTimeToIso } from '../../lib/calendar-time';
import { useCapabilities } from '../../lib/capabilities';
import {
  GROUP_MINIMUM_LEVELS,
  minimumLevelOptions,
} from '../../lib/minimum-level';
import {
  announcementSchema,
  fieldForReason,
} from '../../lib/schemas/announcement';
import { useFormValidation } from '../../lib/use-form-validation';
import { useCreateAnnouncement } from '../../queries/announcements';
import { useMyGroupRoles } from '../../queries/my-groups';
import { useGroups } from '../../queries/reference';
import { announcementOrigins } from './announcement-origins';
import {
  EMPTY_ANNOUNCEMENT_DRAFT,
  type AnnouncementDraft,
} from './announcement-draft';
import { AnnouncementFields } from './AnnouncementFields';

const AUDIENCES: ReadonlyArray<{ value: 'local' | 'org'; label: string }> = [
  { value: 'local', label: 'Doar grupul' },
  { value: 'org', label: 'Toată organizația' },
];

export default function AnnouncementComposeSheet() {
  const { session, claims } = useAuth();
  const capabilities = useCapabilities();
  const myGroups = useMyGroupRoles();
  const groups = useGroups();
  const create = useCreateAnnouncement();
  const [open, setOpen] = useState(false);
  const originFieldId = useId();
  const audienceLabelId = useId();
  const [originId, setOriginId] = useState('');
  const [audience, setAudience] = useState<'local' | 'org'>('local');
  const [pinned, setPinned] = useState(false);
  // The draft as its inputs hold it: the Termen read in Romania (#909), who
  // reads it by the Role names of ruling R29b (everyone by default).
  const [draft, setDraft] = useState<AnnouncementDraft>(
    EMPTY_ANNOUNCEMENT_DRAFT,
  );
  const actorLevel = claims?.member_level ?? 0;
  const levelChoices = minimumLevelOptions(
    GROUP_MINIMUM_LEVELS,
    (level) => actorLevel >= 9 || level <= actorLevel,
  );
  // What the last post became: published, or a request (spec 2026-10-11).
  const [published, setPublished] = useState<'published' | 'pending' | null>(
    null,
  );
  // Ruling R8: the same limits `announcements_guard_text` enforces, checked
  // on blur and on publish; the guard's 23514 reason lands under its field.
  const form = useFormValidation(
    announcementSchema,
    {
      title: draft.title,
      body: draft.body,
      groupId: originId ? Number(originId) : null,
      links: draft.links,
      deadline: draft.deadline
        ? (bucharestWallTimeToIso(draft.deadline) ?? '')
        : null,
    },
    fieldForReason,
  );
  const origins = announcementOrigins(
    [...(groups.data?.values() ?? [])],
    myGroups.data ?? [],
    capabilities.data?.createTopLevelGroups === true,
  );

  if (capabilities.data?.managesAnyGroup !== true) return null;

  function clear() {
    setOriginId('');
    setAudience('local');
    setPinned(false);
    setDraft(EMPTY_ANNOUNCEMENT_DRAFT);
    form.reset();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = form.validate();
    if (!values) return;
    const selected = origins.find((group) => group.id === values.groupId);
    if (!selected || !session?.user.id) {
      form.fail(
        { message: 'announcement_group_required' },
        'Alege un grup din lista disponibilă.',
      );
      return;
    }
    try {
      await create.mutateAsync({
        title: values.title,
        body: values.body,
        group_id: selected.id,
        audience,
        priority: draft.priority,
        pinned,
        links: values.links,
        deadline: values.deadline,
        min_level: draft.minLevel,
      });
      // The insert returns no row (a writer may post outside their own read
      // audience), so the receipt follows the stamp's rule: OSUBB-wide by a
      // writer below BC waits for approval (spec 2026-10-11).
      setPublished(
        actorLevel < 6 && (selected.is_organization || audience === 'org')
          ? 'pending'
          : 'published',
      );
      setOpen(false);
      clear();
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      form.fail(
        cause,
        code === '42501'
          ? 'Nu ai permisiunea să publici din acest grup. Alege un alt grup sau cere ajutor unui coordonator.'
          : 'Anunțul nu a putut fi publicat. Încearcă din nou.',
      );
    }
  }

  const originField = form.field('groupId');

  return (
    <>
      <div className="space-y-1 empty:hidden">
        <FabAction
          label="Anunț nou"
          icon={Plus}
          className="gap-2"
          onSelect={() => {
            setPublished(null);
            setOpen(true);
          }}
        />
        {published && (
          <Toast onClose={() => setPublished(null)}>
            {published === 'pending'
              ? 'Anunțul așteaptă aprobarea BC.'
              : 'Anunțul a fost publicat.'}
          </Toast>
        )}
      </div>
      <FormSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) clear();
        }}
        title="Anunț nou"
        busy={create.isPending}
      >
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          className="flex flex-1 flex-col gap-5"
        >
          <AnnouncementFields
            draft={draft}
            onChange={(patch) =>
              setDraft((current) => ({ ...current, ...patch }))
            }
            form={form}
            levelChoices={levelChoices}
            origin={
              <>
                <div className="grid gap-1.5">
                  <label
                    htmlFor={originFieldId}
                    className="text-sm font-medium"
                  >
                    Grup de origine
                  </label>
                  <Select
                    id={originFieldId}
                    value={originId}
                    placeholder="Alege grupul"
                    options={origins.map((group) => ({
                      value: String(group.id),
                      label: group.is_organization ? 'OSUBB' : group.name,
                    }))}
                    onValueChange={setOriginId}
                    required
                    disabled={
                      myGroups.isPending ||
                      myGroups.isError ||
                      groups.isPending ||
                      groups.isError
                    }
                    {...originField}
                  />
                  <FieldError {...form.errorProps('groupId')} />
                </div>
                {(myGroups.isError || groups.isError) && (
                  <p role="alert" className="m-0 text-sm text-destructive">
                    Nu am putut încărca grupurile. Încearcă din nou.
                  </p>
                )}
                <div className="grid gap-1.5">
                  <span id={audienceLabelId} className="text-sm font-medium">
                    Audiență
                  </span>
                  <SegmentedRadio
                    aria-labelledby={audienceLabelId}
                    options={AUDIENCES}
                    value={audience}
                    onValueChange={setAudience}
                  />
                </div>
              </>
            }
            extra={
              <ChoiceRow className="font-medium">
                <Checkbox
                  checked={pinned}
                  onCheckedChange={(next) => setPinned(next === true)}
                />
                Fixează anunțul
              </ChoiceRow>
            }
          />
          <FieldError>{form.formError}</FieldError>
          <FormSheetFooter>
            <Button
              type="button"
              variant="outline"
              disabled={create.isPending}
              onClick={() => setOpen(false)}
            >
              Renunță
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || origins.length === 0}
            >
              {create.isPending ? 'Se publică…' : 'Publică anunțul'}
            </Button>
          </FormSheetFooter>
        </form>
      </FormSheet>
    </>
  );
}
