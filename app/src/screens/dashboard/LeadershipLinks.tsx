import { Link } from 'react-router';
import { cn } from 'cn';
import { focusRingClass, Panel, panelBoxClass } from '../../components/layout';
import { navFor } from '../../components/shell/navItems';
import type { Capabilities } from '../../lib/capabilities';

/**
 * **Mai mult** on Acasă: the pages the viewer may open that a phone shows
 * on neither the tab bar nor the top bar (Clasament, Voluntari, Campanii,
 * Administrare), as two columns of link tiles — the Administrare section
 * menu's tile, an icon over a name. Below `lg` this is the only way to those
 * pages; from `lg` the sidebar lists them, so the block is not drawn.
 *
 * The list is the shell's own (`navFor`), so a new navigation entry appears
 * here by itself, and a volunteer, who has none, gets no block at all.
 */
export default function LeadershipLinks({
  capabilities,
}: {
  capabilities: Capabilities | undefined;
}) {
  const { elsewhere } = navFor(capabilities);
  if (!elsewhere.length) return null;
  return (
    <Panel title="Mai mult" bare className="lg:hidden">
      <nav aria-label="Paginile conducerii" data-slot="leadership-links">
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0">
          {elsewhere.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.path} className="flex min-w-0">
                <Link
                  to={item.path}
                  className={cn(
                    panelBoxClass,
                    'pressable flex min-h-24 flex-1 flex-col items-start justify-between gap-3 text-foreground no-underline',
                    focusRingClass,
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className="size-5 shrink-0 text-(--red-600)"
                  />
                  <span className="max-w-full text-sm leading-snug font-semibold wrap-break-word hyphens-auto">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </Panel>
  );
}
