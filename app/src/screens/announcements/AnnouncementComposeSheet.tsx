import { useId, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { FieldError } from '../../components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '../../components/ui/native-select';
import {
  ChoiceRow,
  RadioGroup,
  RadioGroupItem,
} from '../../components/ui/radio-group';
import {
  Sheet,
  SheetBackdrop,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
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
import {
  AnnouncementFields,
  announcementFieldClass,
} from './AnnouncementFields';

export default function AnnouncementComposeSheet() {
  const { session, claims } = useAuth();
  const capabilities = useCapabilities();
  const myGroups = useMyGroupRoles();
  const groups = useGroups();
  const create = useCreateAnnouncement();
  const [open, setOpen] = useState(false);
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
  const [published, setPublished] = useState(false);
  // Ruling R8: the same limits `announcements_guard_text` enforces, checked
  // on blur and on publish; the guard's 23514 reason lands under its field.
  const form = useFormValidation(
    announcementSchema,
    {
      title: draft.title,
      body: draft.body,
      groupId: originId ? Number(originId) : null,
      link: { label: draft.linkLabel, url: draft.linkUrl },
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
        form_label: values.link.label,
        form_url: values.link.url,
        deadline: values.deadline,
        min_level: draft.minLevel,
      });
      setPublished(true);
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

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return;
        setOpen(next);
        if (!next) clear();
      }}
    >
      <div className="space-y-1">
        <Button
          type="button"
          onClick={() => {
            setPublished(false);
            setOpen(true);
          }}
          className="min-h-11 gap-2"
        >
          <Plus className="size-4" aria-hidden="true" /> Anunț nou
        </Button>
        {published && (
          <p
            role="status"
            className="text-sm text-emerald-700 dark:text-emerald-400"
          >
            Anunțul a fost publicat.
          </p>
        )}
      </div>
      <SheetPortal>
        <SheetBackdrop />
        <SheetPopup
          side="right"
          className="max-w-xl gap-5 p-4 sm:p-6"
          aria-describedby={undefined}
        >
          <SheetHeader showCloseButton={!create.isPending}>
            <SheetTitle>Anunț nou</SheetTitle>
          </SheetHeader>
          <form
            onSubmit={(event) => void submit(event)}
            noValidate
            className="flex flex-1 flex-col gap-4"
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
                  <div className="space-y-1.5">
                    <label className={announcementFieldClass}>
                      Grup de origine
                      <NativeSelect
                        value={originId}
                        onChange={(event) => setOriginId(event.target.value)}
                        required
                        disabled={
                          myGroups.isPending ||
                          myGroups.isError ||
                          groups.isPending ||
                          groups.isError
                        }
                        {...form.field('groupId')}
                      >
                        <NativeSelectOption value="">
                          Alege grupul
                        </NativeSelectOption>
                        {origins.map((group) => (
                          <NativeSelectOption key={group.id} value={group.id}>
                            {group.is_organization ? 'OSUBB' : group.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </label>
                    <FieldError {...form.errorProps('groupId')} />
                  </div>
                  {(myGroups.isError || groups.isError) && (
                    <p role="alert" className="text-sm text-destructive">
                      Nu am putut încărca grupurile. Încearcă din nou.
                    </p>
                  )}
                  <div className="space-y-1">
                    <span id={audienceLabelId} className="text-sm font-medium">
                      Audiență
                    </span>
                    <RadioGroup
                      aria-labelledby={audienceLabelId}
                      value={audience}
                      onValueChange={(next: 'local' | 'org') =>
                        setAudience(next)
                      }
                      className="flex flex-wrap gap-x-6 gap-y-0"
                    >
                      <ChoiceRow>
                        <RadioGroupItem value="local" />
                        Doar grupul
                      </ChoiceRow>
                      <ChoiceRow>
                        <RadioGroupItem value="org" />
                        Toată organizația
                      </ChoiceRow>
                    </RadioGroup>
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
            <SheetFooter>
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
            </SheetFooter>
          </form>
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}
