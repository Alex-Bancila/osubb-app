import { useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useAuth } from '../../lib/auth';
import {
  useAnnouncementsFeed,
  useMarkAnnouncementRead,
} from '../../queries/announcements';
import { useMemberIdentities } from '../../queries/member-identities';
import { useGroups } from '../../queries/reference';
import {
  countUnreadAnnouncements,
  getUnreadCriticalAnnouncement,
  sortAnnouncements,
  toAnnouncementPresentation,
  type AnnouncementPresentation,
} from './announcements-presentation';
import AnnouncementCard from './AnnouncementCard';
import AnnouncementDetailsSheet from './AnnouncementDetailsSheet';
import CriticalAnnouncementBanner from './CriticalAnnouncementBanner';
import AnnouncementComposeSheet from './AnnouncementComposeSheet';
import { Empty, ErrorState, Loading } from '../../components/states';
import { Page, PageGrid, PageHeader } from '../../components/layout';
import { PreferredGroupsChip } from '../../components/preferred-groups/PreferredGroupsChip';
import { PreferredGroupsScope } from '../../components/preferred-groups/PreferredGroupsScope';
import { usePreferredGroups } from '../../components/preferred-groups/preferred-groups';
import { NewDealControl } from '../deals/DealFormSheet';
import DealsTab from '../deals/DealsTab';
import { DEALS_PATH } from '../deals/deals-presentation';
import { AnnouncementsTabs } from './AnnouncementsTabs';

/** The deep link a "Anunț nou" notification carries: `/anunturi?anunt=<id>` (#843). */
const ANNOUNCEMENT_PARAM = 'anunt';

function parseAnnouncementId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Anunțuri opens on the member's Grupuri preferate (R43): a local
 * Announcement of a Group they unselected waits behind **Arată tot**. A
 * critical or organization-wide Announcement, and the member's own, always
 * show — the same ones the badge still counts.
 */
export default function AnnouncementsScreen() {
  const { pathname } = useLocation();
  // Two tabs, routed (R45): Anunțuri never shows a Deal, OSUBB Deals only Deals.
  if (pathname === DEALS_PATH || pathname.startsWith(`${DEALS_PATH}/`))
    return <DealsScreen />;
  return (
    <PreferredGroupsScope>
      <AnnouncementsContent />
    </PreferredGroupsScope>
  );
}

function DealsScreen() {
  return (
    <Page width="reading">
      <PageHeader
        title="Anunțuri"
        description="Oferte, reduceri și acces pentru membrii OSUBB."
        actions={<NewDealControl />}
      />
      <AnnouncementsTabs />
      <DealsTab />
    </Page>
  );
}

function AnnouncementsContent() {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const feedQuery = useAnnouncementsFeed(memberId);
  const groupsQuery = useGroups();
  const markRead = useMarkAnnouncementRead(memberId);
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<
    number | null
  >(null);
  // #930: the details sheet closes on a delete, so the receipt lives here.
  const [deleted, setDeleted] = useState(false);
  const markedIdsRef = useRef<Set<number>>(new Set());
  const inFlightIdsRef = useRef<Set<number>>(new Set());
  // The `?anunt=` value already opened on this visit: a rerender or a feed
  // refetch never reopens a sheet the member closed.
  const handledParamRef = useRef<string | null>(null);

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
    setSelectedAnnouncementId(announcement.id);
    markAsRead(announcement);
  }

  const rawAnnouncements = feedQuery.data ?? [];
  // Authors as Member Card buttons: one directory read for the whole feed.
  const authors = useMemberIdentities(
    rawAnnouncements.flatMap((row) => (row.created_by ? [row.created_by] : [])),
  );
  const allAnnouncements: AnnouncementPresentation[] = sortAnnouncements(
    rawAnnouncements.map((row) =>
      toAnnouncementPresentation(row, groupsQuery.data, authors.data),
    ),
  );
  const preferred = usePreferredGroups();
  const announcements = allAnnouncements.filter(
    (announcement) =>
      preferred.keepGroup(announcement.groupId) ||
      announcement.priority === 'critical' ||
      announcement.audience === 'org' ||
      announcement.authorMember?.memberId === memberId,
  );

  const unreadCount = countUnreadAnnouncements(announcements);

  // B33: the banner points at a critical Announcement further down; when that
  // Announcement is already the first card, the card is enough.
  const unreadCritical = getUnreadCriticalAnnouncement(announcements);
  const showCriticalBanner =
    unreadCritical !== null && announcements[0]?.id !== unreadCritical.id;

  const selectedAnnouncement =
    allAnnouncements.find((a) => a.id === selectedAnnouncementId) ?? null;

  const isPending = feedQuery.isPending || groupsQuery.isPending;
  const feedReady = !isPending && !feedQuery.isError;

  // D14: `?anunt=<id>` opens that Announcement once the feed is in, and marks
  // it read like a click on "Citește". An id the member cannot read (deleted,
  // or outside their Audience) opens the sheet's unavailable state.
  const paramValue = searchParams.get(ANNOUNCEMENT_PARAM);
  const linkedId = parseAnnouncementId(paramValue);
  const linkedAnnouncement =
    linkedId === null
      ? null
      : (allAnnouncements.find((a) => a.id === linkedId) ?? null);
  const [linkUnavailable, setLinkUnavailable] = useState(false);

  useEffect(() => {
    if (paramValue === null) {
      handledParamRef.current = null;
      return;
    }
    if (!feedReady || handledParamRef.current === paramValue) return;
    handledParamRef.current = paramValue;
    if (linkedAnnouncement) {
      setLinkUnavailable(false);
      handleOpenAnnouncement(linkedAnnouncement);
    } else {
      setSelectedAnnouncementId(null);
      setLinkUnavailable(true);
    }
    // Runs when the param or the feed's readiness changes; the handled ref
    // keeps it to once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramValue, feedReady]);

  function closeDetails() {
    setSelectedAnnouncementId(null);
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

  return (
    <Page width="reading">
      <PageHeader
        title="Anunțuri"
        description={
          unreadCount === 0
            ? 'Toate anunțurile sunt citite'
            : unreadCount === 1
              ? '1 anunț necitit'
              : `${unreadCount} anunțuri necitite`
        }
        actions={<AnnouncementComposeSheet />}
      />
      <AnnouncementsTabs />

      {deleted && (
        <p
          role="status"
          className="m-0 text-sm text-emerald-700 dark:text-emerald-400"
        >
          Anunțul a fost șters.
        </p>
      )}

      {isPending ? (
        <Loading label="Se încarcă anunțurile…" />
      ) : feedQuery.isError ? (
        <ErrorState
          error={feedQuery.error}
          text="Nu am putut încărca anunțurile."
          onRetry={() => void feedQuery.refetch()}
        />
      ) : announcements.length === 0 ? (
        <div className="space-y-4">
          <PreferredGroupsChip />
          <Empty
            bare
            text={
              allAnnouncements.length > 0
                ? 'Niciun anunț în grupurile tale preferate.'
                : 'Nu sunt anunțuri disponibile în acest moment.'
            }
          />
        </div>
      ) : (
        <div className="space-y-6">
          <PreferredGroupsChip />
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
    </Page>
  );
}
