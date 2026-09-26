import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { AttachedLinkFields } from '../../components/attached-link/AttachedLinkFields';
import { Button } from '../../components/ui/button';
import { FieldError } from '../../components/ui/field';
import {
  Sheet,
  SheetBackdrop,
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

export default function AnnouncementComposeSheet() {
  const { session } = useAuth();
  const capabilities = useCapabilities();
  const myGroups = useMyGroupRoles();
  const groups = useGroups();
  const create = useCreateAnnouncement();
  const [open, setOpen] = useState(false);
  const [originId, setOriginId] = useState('');
  const [audience, setAudience] = useState<'local' | 'org'>('local');
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
    const extra = new FormData(event.currentTarget);
    try {
      await create.mutateAsync({
        title: values.title,
        body: values.body,
        group_id: selected.id,
        audience,
        priority: String(extra.get('priority') ?? 'normal') as
          'normal' | 'important' | 'critical',
        pinned: extra.get('pinned') === 'on',
        form_label: values.link.label,
        form_url: values.link.url,
        created_by: session.user.id,
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
          className="right-0 left-auto w-full max-w-xl overflow-y-auto p-5 sm:p-7"
          aria-describedby={undefined}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <SheetTitle className="font-heading text-xl font-semibold">
              Anunț nou
            </SheetTitle>
            <Button
              type="button"
              variant="outline"
              disabled={create.isPending}
              onClick={() => setOpen(false)}
            >
              Închide
            </Button>
          </div>
          <form
            onSubmit={(event) => void submit(event)}
            noValidate
            className="space-y-4"
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
                <select
                  className={inputClass}
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
                  <option value="">Alege grupul</option>
                  {origins.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <FieldError {...form.errorProps('groupId')} />
            </div>
            {(myGroups.isError || groups.isError) && (
              <p role="alert" className="text-sm text-destructive">
                Nu am putut încărca grupurile. Încearcă din nou.
              </p>
            )}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Audiență</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="audience"
                    checked={audience === 'local'}
                    onChange={() => setAudience('local')}
                  />{' '}
                  Doar grupul
                </label>
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="radio"
                    name="audience"
                    checked={audience === 'org'}
                    onChange={() => setAudience('org')}
                  />{' '}
                  Toată organizația
                </label>
              </div>
            </fieldset>
            <label className={fieldClass}>
              Prioritate
              <select
                className={inputClass}
                name="priority"
                defaultValue="normal"
              >
                <option value="normal">Normală</option>
                <option value="important">Importantă</option>
                <option value="critical">Critică</option>
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="pinned" /> Fixează anunțul
            </label>
            <div className="space-y-3 rounded-lg border p-3 sm:p-4">
              <p className="text-sm font-medium">Formular asociat (opțional)</p>
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
            <Button
              type="submit"
              disabled={create.isPending || origins.length === 0}
              className="min-h-11 w-full"
            >
              {create.isPending ? 'Se publică…' : 'Publică anunțul'}
            </Button>
          </form>
        </SheetPopup>
      </SheetPortal>
    </Sheet>
  );
}
