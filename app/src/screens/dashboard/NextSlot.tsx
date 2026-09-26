import { useId, type ReactNode } from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';

/**
 * One of Acasă's two "what is next" slots (ruling R4): a small heading, the
 * deep link into the page that holds the item, and the item's own card — the
 * Tracker's `TaskCard` or the Calendar's `EventCard`, never a copy of either.
 * The link appears only with an item, because it opens that item.
 */
export function NextSlot({
  title,
  icon: Icon,
  link,
  children,
}: {
  title: string;
  icon: LucideIcon;
  link?: { to: string; label: string } | null;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="next-slot" aria-labelledby={titleId}>
      <header className="next-head">
        <h2 id={titleId} className="next-title">
          <Icon aria-hidden="true" />
          {title}
        </h2>
        {link && (
          <Link to={link.to} className="next-link">
            {link.label}
            <ArrowRight aria-hidden="true" />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/** The frame the loading, empty and error states sit in, card-shaped. */
export function NextPlaceholder({ children }: { children: ReactNode }) {
  return <div className="next-placeholder">{children}</div>;
}
