import { PageTabs } from '../../components/layout';
import { useUnreadCountByKind } from '../../queries/deals';
import { ANNOUNCEMENTS_PATH } from '../../components/shell/navItems';
import { DEALS_PATH } from '../deals/deals-presentation';

function TabLabel({ text, unread }: { text: string; unread: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      {text}
      {unread > 0 && (
        <span
          aria-label={`${unread} necitite`}
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] leading-5 font-bold text-white tabular-nums in-aria-[current=page]:bg-brand-black in-aria-[current=page]:text-brand-white"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </span>
  );
}

/** Anunțuri | OSUBB Deals, routed (`/anunturi`, `/anunturi/deals`). */
export function AnnouncementsTabs() {
  const announcements = useUnreadCountByKind('announcement');
  const deals = useUnreadCountByKind('deal');
  const unread = {
    announcements: announcements.data ?? 0,
    deals: deals.data ?? 0,
  };
  return (
    <PageTabs
      label="Anunțuri și deal-uri"
      tabs={[
        {
          to: ANNOUNCEMENTS_PATH,
          end: true,
          label: <TabLabel text="Anunțuri" unread={unread.announcements} />,
        },
        {
          to: DEALS_PATH,
          label: <TabLabel text="OSUBB Deals" unread={unread.deals} />,
        },
      ]}
    />
  );
}
