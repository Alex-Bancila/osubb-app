import { Toast } from '../../components/ui/toast';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../lib/auth';
import { useInView } from '../../lib/use-in-view';
import { useSwipeTabs } from '../../lib/swipe-tabs';
import { ANNOUNCEMENTS_PATH } from '../../components/shell/navItems';
import {
  ANNOUNCEMENT_PAGE,
  useAnnouncement,
  useAnnouncementFeed,
  useAnnouncementFeedSummary,
  useMarkAnnouncementRead,
  type AnnouncementFeedSummary,
  type FeedFilters,
  type RawAnnouncementRow,
} from '../../queries/announcements';
import type { MemberIdentity } from '../../components/member/member-identity';
import { useMemberIdentitiesByPage } from '../../queries/member-identities';
import { useGroups, type Group } from '../../queries/reference';
import {
  toAnnouncementPresentation,
  type AnnouncementPresentation,
} from './announcements-presentation';
import AnnouncementCard from './AnnouncementCard';
import AnnouncementDetailsSheet from './AnnouncementDetailsSheet';
import CriticalAnnouncementBanner from './CriticalAnnouncementBanner';
import AnnouncementComposeSheet from './AnnouncementComposeSheet';
import { ApprovalRequestsButton } from '../../components/approvals/ApprovalRequestsButton';
import { Empty, ErrorState, Loading } from '../../components/states';
import {
  FabActions,
  Page,
  PageGrid,
  PageHeader,
} from '../../components/layout';
import { PreferredGroupsScope } from '../../components/preferred-groups/PreferredGroupsScope';
import { usePreferredGroups } from '../../components/preferred-groups/preferred-groups';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { WorkFilter } from '../../components/work-filter/WorkFilter';
import { useWorkFilter } from '../../lib/use-work-filter';
import { chosenGroupId, type WorkFilterLevels } from '../../lib/work-filter';
import { NewDealControl } from '../deals/DealFormSheet';
import DealsTab from '../deals/DealsTab';
import { DEALS_PATH } from '../deals/deals-presentation';
import { AnnouncementsTabs } from './AnnouncementsTabs';

/** The deep link a "Anunț nou" notification carries: `/anunturi?anunt=<id>` (#843). */
const ANNOUNCEMENT_PARAM = 'anunt';

/** Anunțuri filters by Group alone: an Announcement has no Campaign or day. */
const FILTER_LEVELS: WorkFilterLevels = { campaign: false, dates: false };

function parseAnnouncementId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The authors of some rows, as their Member Card buttons need them. */
function authorsOf(
  rows: readonly (RawAnnouncementRow | null | undefined)[],
): string[] {
  return rows.flatMap((row) => (row?.created_by ? [row.created_by] : []));
}

/**
 * Why the feed is empty: from the summary's counts once they have answered,
 * else (they failed) from the filters in force.
 */
function emptyFeedText(
  counts: AnnouncementFeedSummary | undefined,
  groupChosen: boolean,
  preferredOnly: boolean,
): string {
  const nothing = 'Nu sunt anunțuri disponibile în acest moment.';
  const noneInGroup = 'Niciun anunț în grupul ales.';
  const nonePreferred = 'Niciun anunț în grupurile tale preferate.';
  if (counts) {
    if (counts.everything === 0) return nothing;
    return groupChosen && counts.preferred > 0 ? noneInGroup : nonePreferred;
  }
  if (groupChosen) return noneInGroup;
  return preferredOnly ? nonePreferred : nothing;
}

/** A row read by its id, presented as the feed's rows are. */
function presented(
  row: RawAnnouncementRow | null | undefined,
  groups: ReadonlyMap<number, Group> | undefined,
  authors: ReadonlyMap<string, MemberIdentity>,
): AnnouncementPresentation | null {
  return row ? toAnnouncementPresentation(row, groups, authors) : null;
}

/**
 * Anunțuri opens on the member's Grupuri preferate (R43): a local
 * Announcement of a Group they unselected waits behind the star beside Filtrează. A
 * critical or organization-wide Announcement, and the member's own, always
 * show — the same ones the badge still counts.
 */
export default function AnnouncementsScreen() {
  const { pathname } = useLocation();
  // Two tabs, routed (R45): Anunțuri never shows a Deal, OSUBB Deals only Deals.
  const deals =
    pathname === DEALS_PATH || pathname.startsWith(`${DEALS_PATH}/`);
  const navigate = useNavigate();
  // A swipe over the tab's content moves between the two as a tap would (2026-10-11).
  const swipe = useSwipeTabs<string>({
    order: [ANNOUNCEMENTS_PATH, DEALS_PATH],
    current: deals ? DEALS_PATH : ANNOUNCEMENTS_PATH,
    onSelect: (path) => void navigate(path),
  });
  // The page, its tabs and the plus button stay while the tab under them
  // changes, so the tabs' thumb slides; each tab draws its own header into
  // this slot above them.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  return (
    <Page width="reading">
      <FabActions>
        <div ref={setHeaderSlot} className="contents" />
        <AnnouncementsTabs />
        <div
          key={deals ? 'deals' : 'announcements'}
          className="flex min-w-0 motion-enter flex-col gap-6"
          {...swipe}
        >
          {deals ? (
            <>
              {headerSlot &&
                createPortal(
                  <PageHeader title="Anunțuri" actions={<NewDealControl />} />,
                  headerSlot,
                )}
              <DealsTab />
            </>
          ) : (
            <PreferredGroupsScope>
              <AnnouncementsContent headerSlot={headerSlot} />
            </PreferredGroupsScope>
          )}
        </div>
      </FabActions>
    </Page>
  );
}

/**
 * The feed is read 20 at a time (R56), in the server's R15 order: pinned,
 * then unread, then read. The server also narrows it — Grupuri preferate,
 * the Group filter — and counts what the page shows around it: the header's
 * unread count, the critical banner, the empty states. An Announcement a
 * link, the banner or an open sheet names that is not among the loaded
 * pages is read by its id.
 */
function AnnouncementsContent({
  headerSlot,
}: {
  headerSlot: HTMLElement | null;
}) {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const groupsQuery = useGroups();
  const markRead = useMarkAnnouncementRead(memberId);
  const [searchParams, setSearchParams] = useSearchParams();

  // Filtrează, by Group: the chosen Group and every Group below it.
  const filter = useWorkFilter(FILTER_LEVELS);
  const [filterSlot, setFilterSlot] = useState<HTMLElement | null>(null);
  const filterGroups = useMemo(
    () => [...(groupsQuery.data?.values() ?? [])],
    [groupsQuery.data],
  );
  const filterGroupId = chosenGroupId(filter.value);
  const preferred = usePreferredGroups();
  const feedFilters = useMemo<FeedFilters>(
    () =>
      filterGroupId === undefined
        ? { p_preferred: preferred.active }
        : { p_group_id: filterGroupId, p_preferred: preferred.active },
    [filterGroupId, preferred.active],
  );
  const feed = useAnnouncementFeed(feedFilters, true);
  const summary = useAnnouncementFeedSummary(feedFilters, true);

  // The Announcement whose sheet is open, as it was opened: it stays drawn
  // if a change drops the page it came from.
  const [selected, setSelected] = useState<AnnouncementPresentation | null>(
    null,
  );
  // #930: the details sheet closes on a delete, so the receipt lives here.
  const [deleted, setDeleted] = useState(false);
  const markedIdsRef = useRef<Set<number>>(new Set());
  const inFlightIdsRef = useRef<Set<number>>(new Set());
  // The `?anunt=` value already opened on this visit: a rerender or a feed
  // refetch never reopens a sheet the member closed.
  const handledParamRef = useRef<string | null>(null);
  const [linkUnavailable, setLinkUnavailable] = useState(false);

  const isPending = feed.isPending || groupsQuery.isPending;
  const feedReady = !isPending && !feed.isError;

  // Read by its id only once the first page has landed without it.
  const loadedIds = useMemo(
    () => new Set(feed.rows.map((row) => row.id)),
    [feed.rows],
  );
  const notLoaded = (id: number | null) =>
    feedReady && id !== null && !loadedIds.has(id) ? id : null;
  const paramValue = searchParams.get(ANNOUNCEMENT_PARAM);
  const linkedId = parseAnnouncementId(paramValue);
  const criticalId = summary.data?.criticalId ?? null;
  const linkedRead = useAnnouncement(notLoaded(linkedId));
  const criticalRead = useAnnouncement(notLoaded(criticalId));
  const selectedRead = useAnnouncement(notLoaded(selected?.id ?? null));

  // Authors as Member Card buttons, read page by page (and those of the
  // rows read by their id), so a page that lands reads only its own.
  const authorPages = useMemo(() => {
    const pages: string[][] = [];
    for (let start = 0; start < feed.rows.length; start += ANNOUNCEMENT_PAGE)
      pages.push(authorsOf(feed.rows.slice(start, start + ANNOUNCEMENT_PAGE)));
    const elsewhere = authorsOf([
      linkedRead.data,
      criticalRead.data,
      selectedRead.data,
    ]);
    if (elsewhere.length > 0) pages.push(elsewhere);
    return pages;
  }, [feed.rows, linkedRead.data, criticalRead.data, selectedRead.data]);
  const authors = useMemberIdentitiesByPage(authorPages);

  const announcements = useMemo(
    () =>
      feed.rows.map((row) =>
        toAnnouncementPresentation(row, groupsQuery.data, authors),
      ),
    [feed.rows, groupsQuery.data, authors],
  );
  const loaded = useMemo(
    () => new Map(announcements.map((item) => [item.id, item])),
    [announcements],
  );
  const linkedFound = useMemo(
    () => presented(linkedRead.data, groupsQuery.data, authors),
    [linkedRead.data, groupsQuery.data, authors],
  );
  const criticalFound = useMemo(
    () => presented(criticalRead.data, groupsQuery.data, authors),
    [criticalRead.data, groupsQuery.data, authors],
  );
  const selectedFound = useMemo(
    () => presented(selectedRead.data, groupsQuery.data, authors),
    [selectedRead.data, groupsQuery.data, authors],
  );

  // The header counts what the member has to read; the Group filter only
  // narrows the list below it.
  const unreadCount = summary.data?.unread ?? 0;

  // B33: the banner points at a critical Announcement further down; when that
  // Announcement is already the first card, the card is enough.
  const unreadCritical =
    criticalId === null ? null : (loaded.get(criticalId) ?? criticalFound);
  const showCriticalBanner =
    unreadCritical !== null && announcements[0]?.id !== unreadCritical.id;

  const selectedAnnouncement =
    selected === null
      ? null
      : (loaded.get(selected.id) ?? selectedFound ?? selected);

  function markAsRead(announcement: AnnouncementPresentation) {
    if (
      !announcement.isRead &&
      !markedIdsRef.current.has(announcement.id) &&
      !inFlightIdsRef.current.has(announcement.id)
    ) {
      inFlightIdsRef.current.add(announcement.id);
      markRead.mutate(announcement.id, {
        onSuccess: () => {
          markedIdsRef.current.add(announcement.id);
        },
        onError: () => {
          markedIdsRef.current.delete(announcement.id);
        },
        onSettled: () => {
          inFlightIdsRef.current.delete(announcement.id);
        },
      });
    }
  }

  function handleOpenAnnouncement(announcement: AnnouncementPresentation) {
    setDeleted(false);
    setSelected(announcement);
    markAsRead(announcement);
  }

  // D14: `?anunt=<id>` opens that Announcement once the feed is in — from
  // the loaded rows, or read by its id — and marks it read like a click on
  // "Citește". An id the member cannot read (deleted, or outside their
  // Audience) opens the sheet's unavailable state.
  const linked =
    linkedId === null ? null : (loaded.get(linkedId) ?? linkedFound);
  const linkAnswered =
    linkedId === null ||
    linked !== null ||
    linkedRead.data === null ||
    linkedRead.isError;

  useEffect(() => {
    if (paramValue === null) {
      handledParamRef.current = null;
      return;
    }
    if (!feedReady || !linkAnswered || handledParamRef.current === paramValue)
      return;
    handledParamRef.current = paramValue;
    if (linked) {
      setLinkUnavailable(false);
      handleOpenAnnouncement(linked);
    } else {
      setSelected(null);
      setLinkUnavailable(true);
    }
    // Runs when the param, the feed's readiness or the link's answer
    // changes; the handled ref keeps it to once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramValue, feedReady, linkAnswered]);

  function closeDetails() {
    setSelected(null);
    setLinkUnavailable(false);
    if (searchParams.has(ANNOUNCEMENT_PARAM)) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete(ANNOUNCEMENT_PARAM);
          return next;
        },
        { replace: true },
      );
    }
  }

  // Armed only while nothing is read: not during the next page, nor while
  // the first page is read again after a change. Re-armed when that lands,
  // it asks at once if the end is still in view.
  const sentinel = useInView(
    feed.loadMore,
    feed.hasMore && !feed.isLoadingMore && !feed.isFetching && !feed.moreFailed,
  );

  // An empty feed says why once the summary has answered.
  const emptyWaits = announcements.length === 0 && summary.isPending;

  return (
    <>
      {headerSlot &&
        createPortal(
          <PageHeader
            title="Anunțuri"
            badge={
              unreadCount > 0 && (
                <Badge
                  variant="destructive"
                  className="h-6 gap-1.5 px-2.5 text-sm"
                >
                  <Mail aria-hidden="true" />
                  <span aria-hidden="true">{unreadCount}</span>
                  <span className="sr-only">
                    {unreadCount === 1
                      ? '1 anunț necitit'
                      : `${unreadCount} anunțuri necitite`}
                  </span>
                </Badge>
              )
            }
            actions={
              <>
                {/* Filtrează is drawn here by the Work Filter below. */}
                <span ref={setFilterSlot} className="contents" />
                {/* The Cereri de aprobare (spec 2026-10-11), beside Filtrează. */}
                <ApprovalRequestsButton kind="announcement" />
                <AnnouncementComposeSheet />
              </>
            }
          />,
          headerSlot,
        )}
      {/* Its row holds the active filter's chips and Grupuri preferate. */}
      <WorkFilter
        label="Filtre anunțuri"
        groups={filterGroups}
        campaigns={[]}
        levels={FILTER_LEVELS}
        alwaysShowGroups
        hint="Grupul include subgrupurile sale."
        status={{
          pending: groupsQuery.isPending,
          failed: groupsQuery.isError,
          error: groupsQuery.error,
          onRetry: () => void groupsQuery.refetch(),
        }}
        buttonSlot={filterSlot}
      />

      {deleted && (
        <Toast onClose={() => setDeleted(false)}>Anunțul a fost șters.</Toast>
      )}

      {isPending || (feedReady && emptyWaits) ? (
        <Loading label="Se încarcă anunțurile…" />
      ) : feed.isError ? (
        <ErrorState
          error={feed.error}
          text="Nu am putut încărca anunțurile."
          onRetry={feed.refetch}
        />
      ) : announcements.length === 0 ? (
        <Empty
          bare
          text={emptyFeedText(
            summary.data,
            filterGroupId !== undefined,
            preferred.active,
          )}
        />
      ) : (
        <div className="space-y-6">
          {showCriticalBanner && (
            <CriticalAnnouncementBanner
              announcement={unreadCritical}
              onOpen={handleOpenAnnouncement}
            />
          )}

          <PageGrid
            columns={1}
            as="ul"
            role="list"
            aria-label="Flux de anunțuri"
          >
            {announcements.map((announcement) => (
              <li key={announcement.id}>
                <AnnouncementCard
                  announcement={announcement}
                  onOpen={handleOpenAnnouncement}
                />
              </li>
            ))}
          </PageGrid>
          {feed.moreFailed ? (
            <ErrorState
              text="Nu am putut încărca mai multe anunțuri."
              onRetry={feed.loadMore}
            />
          ) : (
            feed.hasMore && (
              // The end of the list: coming into view, it asks for the next
              // page; the button does the same for a keyboard.
              <div ref={sentinel} className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  disabled={feed.isLoadingMore}
                  onClick={feed.loadMore}
                >
                  {feed.isLoadingMore ? 'Se încarcă…' : 'Încarcă mai multe'}
                </Button>
              </div>
            )
          )}
        </div>
      )}

      <AnnouncementDetailsSheet
        announcement={selectedAnnouncement}
        unavailable={linkUnavailable}
        onClose={closeDetails}
        onDeleted={() => {
          closeDetails();
          setDeleted(true);
        }}
      />
    </>
  );
}
