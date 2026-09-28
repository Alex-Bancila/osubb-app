import { useId, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { AttachedLinkFields } from '../../components/attached-link/AttachedLinkFields';
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
import { useCapabilities } from '../../lib/capabilities';
import {
  announcementSchema,
  fieldForReason,
} from '../../lib/schemas/announcement';
import { useFormValidation } from '../../lib/use-form-validation';
import { useCreateAnnouncement } from '../../queries/announcements';
import { useMyGroupRoles } from '../../queries/my-groups';
import { useGroups } from '../../queries/reference';
import { announcementOrigins } from './announcement-origins';

const inputClass =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring';
const fieldClass = 'block space-y-1.5 text-sm font-medium text-foreground';

type Priority = 'normal' | 'important' | 'critical';

export default function AnnouncementComposeSheet() {
  const { session } = useAuth();
  const capabilities = useCapabilities();
  const myGroups = useMyGroupRoles();
  const groups = useGroups();
  const create = useCreateAnnouncement();
  const [open, setOpen] = useState(false);
  const audienceLabelId = useId();
  const linkGroupLabelId = useId();
  const [originId, setOriginId] = useState('');
  const [audience, setAudience] = useState<'local' | 'org'>('local');
  const [priority, setPriority] = useState<Priority>('normal');
  const [pinned, setPinned] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [published, setPublished] = useState(false);
  // Ruling R8: the same limits `announcements_guard_text` enforces, checked
  // on blur and on publish; the guard's 23514 reason lands under its field.
  const form = useFormValidation(
    announcementSchema,
    {
      title,
      body,
      groupId: originId ? Number(originId) : null,
      link: { label: linkLabel, url: linkUrl },
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
    setPriority('normal');
    setPinned(false);
    setTitle('');
    setBody('');
    setLinkLabel('');
    setLinkUrl('');
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
        priority,
        pinned,
        form_label: values.link.label,
        form_url: values.link.url,
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
            <div className="space-y-1.5">
              <label className={fieldClass}>
                Titlu
                <input
                  className={inputClass}
                  name="title"
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  {...form.field('title')}
                />
              </label>
              <FieldError {...form.errorProps('title')} />
            </div>
            <div className="space-y-1.5">
              <label className={fieldClass}>
                Mesaj
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  name="body"
                  required
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  {...form.field('body')}
                />
              </label>
              <FieldError {...form.errorProps('body')} />
            </div>
            <div className="space-y-1.5">
              <label className={fieldClass}>
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
                  <NativeSelectOption value="">Alege grupul</NativeSelectOption>
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
                onValueChange={(next: 'local' | 'org') => setAudience(next)}
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
            <label className={fieldClass}>
              Prioritate
              <NativeSelect
                name="priority"
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as Priority)
                }
              >
                <NativeSelectOption value="normal">Normală</NativeSelectOption>
                <NativeSelectOption value="important">
                  Importantă
                </NativeSelectOption>
                <NativeSelectOption value="critical">
                  Critică
                </NativeSelectOption>
              </NativeSelect>
            </label>
            <ChoiceRow className="font-medium">
              <Checkbox
                checked={pinned}
                onCheckedChange={(next) => setPinned(next === true)}
              />
              Fixează anunțul
            </ChoiceRow>
            <div
              role="group"
              aria-labelledby={linkGroupLabelId}
              className="space-y-3 rounded-md border p-4"
            >
              <p id={linkGroupLabelId} className="text-sm font-medium">
                Link atașat (opțional)
              </p>
              <AttachedLinkFields
                value={{ label: linkLabel, url: linkUrl }}
                onChange={(next) => {
                  setLinkLabel(next.label);
                  setLinkUrl(next.url);
                }}
                form={form}
                name="link"
              />
            </div>
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
