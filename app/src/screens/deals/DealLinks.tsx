import { ExternalLink } from 'lucide-react';
import { AttachedLinkButton } from '../../components/attached-link/AttachedLinkButton';
import { AttachedLinkFields } from '../../components/attached-link/AttachedLinkFields';
import { safeHttpUrl } from '../../lib/links';
import type { useFormValidation } from '../../lib/use-form-validation';
import type { DealLink } from '../../queries/deals';

/*
 * The one seam between a Deal and the Attached Link components (ruling R46).
 * A Deal stores `links`, up to five; the shared editor for a list of links
 * lands with the five-link work, and this adapter is the only place that
 * changes when it does. Until then a Deal is written with the single
 * label-and-address pair at `links.0`, and shown with every link it carries.
 */

export type DealLinkDraft = { label: string; url: string };

type Bound = Pick<ReturnType<typeof useFormValidation>, 'field' | 'errorProps'>;

/** The Deal form's links: the rows as typed, validated at `links.<n>`. */
export function DealLinksField({
  value,
  onChange,
  form,
}: {
  value: DealLinkDraft[];
  onChange: (value: DealLinkDraft[]) => void;
  form: Bound;
}) {
  const first = value[0] ?? { label: '', url: '' };
  return (
    <AttachedLinkFields
      value={first}
      onChange={(next) => onChange([next, ...value.slice(1)])}
      form={form}
      name="links.0"
    />
  );
}

/** On a card: each link as a button under its bare label (R46). */
export function DealLinkButtons({ links }: { links: readonly DealLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link, index) => (
        <AttachedLinkButton
          key={`${index}-${link.url}`}
          label={link.label}
          url={link.url}
        />
      ))}
    </div>
  );
}

/** In the details sheet: "Deschide: <etichetă>" for each link (R46). */
export function DealLinkList({ links }: { links: readonly DealLink[] }) {
  const safe = links.flatMap((link) => {
    const href = safeHttpUrl(link.url);
    return link.label && href ? [{ label: link.label, href }] : [];
  });
  if (safe.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0 sm:flex-row sm:flex-wrap">
      {safe.map((link, index) => (
        <li key={`${index}-${link.href}`}>
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Deschide: ${link.label} (se deschide într-o filă nouă)`}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span aria-hidden="true">Deschide: {link.label}</span>
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
