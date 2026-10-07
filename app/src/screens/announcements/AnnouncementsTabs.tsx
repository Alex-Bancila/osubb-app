import { PageTabs } from '../../components/layout';
import { useUnreadAnnouncementsCount } from '../../queries/announcements';
import { useDeals } from '../../queries/deals';
import { ANNOUNCEMENTS_PATH } from '../../components/shell/navItems';
import { DEALS_PATH, splitUnread } from '../deals/deals-presentation';

function TabLabel({ text, unread }: { text: string; unread: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      {text}
      {unread > 0 && (
        <span
          aria-label={`${unread} necitite`}
          className="inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] leading-5 font-bold text-white tabular-nums"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </span>
  );
}

/** Anunțuri | OSUBB Deals, routed (`/anunturi`, `/anunturi/deals`). */
export function AnnouncementsTabs() {
  const total = useUnreadAnnouncementsCount();
  const deals = useDeals();
  const unread = splitUnread(total.data ?? 0, deals.data ?? []);
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
