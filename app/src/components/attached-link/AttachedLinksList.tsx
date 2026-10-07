import type { AttachedLink } from '../../lib/schemas/attached-link';
import { safeHttpUrl } from '../../lib/links';
import { cn } from '../../lib/utils';
import { AttachedLinkButton } from './AttachedLinkButton';

type AttachedLinksListProps = {
  links: readonly AttachedLink[];
  /**
   * `card`: the bare label on each button, as a card has room for (R46).
   * `details`: "Deschide: <etichetă>", where the details view says what the
   * button does.
   */
  variant: 'card' | 'details';
  className?: string;
  /** Passed to each button (a card's `max-w-full`, for long labels). */
  buttonClassName?: string;
};

/**
 * An Announcement's or a Task's Attached Links (ruling R46), in order, as a
 * wrapping row of `AttachedLinkButton`s — the one way a link is shown. A link
 * whose address is not http(s) is left out, as the button itself would; the
 * list renders nothing when no link is left.
 */
export function AttachedLinksList({
  links,
  variant,
  className,
  buttonClassName,
}: AttachedLinksListProps) {
  const shown = links.filter((link) => link.label && safeHttpUrl(link.url));
  if (!shown.length) return null;
  return (
    <ul
      aria-label="Linkuri atașate"
      className={cn('m-0 flex list-none flex-wrap gap-2 p-0', className)}
    >
      {shown.map((link, index) => (
        <li key={`${index}-${link.url}`} className="min-w-0 max-w-full">
          <AttachedLinkButton
            label={link.label}
            url={link.url}
            text={
              variant === 'details' ? `Deschide: ${link.label}` : link.label
            }
            className={buttonClassName}
          />
        </li>
      ))}
    </ul>
  );
}
