import { Star } from 'lucide-react';
import { cn } from 'cn';
import { usePopMotion } from '../../lib/motion';
import { Button } from '../ui/button';
import { usePreferredGroups } from './preferred-groups';

/**
 * The star beside a page's filter (R43): pressed, the page shows only the
 * member's Grupuri preferate; pressing it shows every Group for this visit,
 * and pressing it again goes back. One 44 px icon button on the toolbar's
 * row, named "Doar grupurile preferate" and `aria-pressed` — the preference
 * itself is edited on Profil › Preferințe. Nothing for anyone who has not
 * unselected a Group.
 */
export function PreferredGroupsChip({ className }: { className?: string }) {
  const view = usePreferredGroups();
  const pop = usePopMotion<SVGSVGElement>(view.active);
  if (!view.available) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      data-slot="preferred-groups-chip"
      aria-label="Doar grupurile preferate"
      aria-pressed={view.active}
      title={
        view.active
          ? 'Vezi doar grupurile preferate. Apasă pentru toate grupurile.'
          : 'Vezi toate grupurile. Apasă pentru doar cele preferate.'
      }
      className={cn('shrink-0', className)}
      onClick={view.active ? view.showAll : view.showPreferred}
    >
      <Star
        aria-hidden="true"
        ref={pop}
        className={cn(
          view.active ? 'fill-primary text-primary' : 'text-muted-foreground',
        )}
      />
    </Button>
  );
}
