import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Sheet,
  SheetBackdrop,
  SheetPopup,
  SheetPortal,
  SheetTitle,
} from '../../components/ui/sheet';
import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
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
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const origins = announcementOrigins(
    [...(groups.data?.values() ?? [])],
    myGroups.data ?? [],
    capabilities.data?.createTopLevelGroups === true,
  );

  if (capabilities.data?.managesAnyGroup !== true) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const body = String(form.get('body') ?? '').trim();
    if (!title || !body) {
      setError('Completează titlul și mesajul anunțului.');
      return;
    }
    const selected = origins.find((group) => group.id === Number(originId));
    if (!selected || !session?.user.id) {
      setError('Alege un grup din lista disponibilă.');
      return;
    }
    const label = String(form.get('form_label') ?? '').trim();
    const url = String(form.get('form_url') ?? '').trim();
    if (Boolean(label) !== Boolean(url)) {
      setError('Completează atât numele, cât și adresa formularului.');
      return;
    }
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
          throw new Error('Invalid scheme');
      } catch {
        setError(
          'Adresa formularului trebuie să fie un link http sau https valid.',
        );
        return;
      }
    }
    try {
      await create.mutateAsync({
        title,
        body,
        group_id: selected.id,
        audience,
        priority: String(form.get('priority') ?? 'normal') as
          'normal' | 'important' | 'critical',
        pinned: form.get('pinned') === 'on',
        form_label: label || null,
        form_url: url || null,
        created_by: session.user.id,
      });
      setPublished(true);
      setOpen(false);
      setOriginId('');
      setAudience('local');
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      setError(
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
        if (!next) setError(null);
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
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <label className={fieldClass}>
              Titlu
              <input
                className={inputClass}
                name="title"
                required
                maxLength={200}
              />
            </label>
            <label className={fieldClass}>
              Mesaj
              <textarea
                className={`${inputClass} min-h-24 resize-y`}
                name="body"
                required
              />
            </label>
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
              >
                <option value="">Alege grupul</option>
                {origins.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
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
              <label className={fieldClass}>
                Nume formular
                <input
                  className={inputClass}
                  name="form_label"
                  maxLength={200}
                />
              </label>
              <label className={fieldClass}>
                Adresă formular
                <input
                  className={inputClass}
                  name="form_url"
                  type="url"
                  placeholder="https://"
                />
              </label>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
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
