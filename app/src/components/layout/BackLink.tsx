import { ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { cn } from 'cn';
import { readBackLinkState, type BackLinkTarget } from './back-link-state';
import { focusRingClass } from './focus';

/**
 * The one back link (layout X16): muted text with an arrow, a 44 px target,
 * above the `PageHeader`. `to` and `label` are the page's own parent; when
 * the page was opened with `state.from` (see `backLinkState`), that wins, so
 * the link returns to where the member actually came from (navigation D10).
 *
 * Directly in a `Page` it sits 12 px above the header, not the page's 24 px:
 * it belongs to the header.
 */
export function BackLink({
  to,
  label,
  className,
}: BackLinkTarget & { className?: string }) {
  const location = useLocation();
  const target = readBackLinkState(location.state) ?? { to, label };
  return (
    <Link
      to={target.to}
      data-slot="back-link"
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm text-sm font-medium text-muted-foreground no-underline underline-offset-4 hover:text-foreground hover:underline [[data-slot=page]>&]:-mb-3',
        focusRingClass,
        className,
      )}
    >
      <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
      {target.label}
    </Link>
  );
}
