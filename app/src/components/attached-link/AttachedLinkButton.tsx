import { ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';

type AttachedLinkButtonProps = {
  /** The label the address is shown under (`fieldForReason`'s `label`). */
  label: string | null | undefined;
  /** The address, already normalised (trimmed, empty turned to `null`). */
  url: string | null | undefined;
  className?: string;
};

/**
 * The one way an Attached Link is shown (CONTEXT.md's glossary, ruling R7 of
 * the 2026-09-23 grill): a button-styled link under its label, opening in a
 * new tab. Renders nothing unless both a label and an address are present
 * and the address is `http://` or `https://` — a defensive re-check of the
 * server's rule (`private.is_http_url`, #673), so a row written before the
 * guard existed, or edited outside it, can never open `javascript:` or
 * another scheme.
 */
export function AttachedLinkButton({
  label,
  url,
  className,
}: AttachedLinkButtonProps) {
  if (!label || !url || !/^https?:\/\//.test(url)) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // The accessible name is set explicitly, not composed from the visible
      // label plus a hidden span: joining text nodes across elements is not
      // guaranteed to insert the space between them.
      aria-label={`${label} (se deschide într-o filă nouă)`}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:text-sm',
        className,
      )}
    >
      <span aria-hidden="true">{label}</span>
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}
