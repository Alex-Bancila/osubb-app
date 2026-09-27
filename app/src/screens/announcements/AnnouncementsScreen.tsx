import { useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import {
  useAnnouncementsFeed,
  useMarkAnnouncementRead,
} from '../../queries/announcements';
import { useMemberIdentities } from '../../queries/member-identities';
import { useGroups } from '../../queries/reference';
import {
  countUnreadAnnouncements,
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

export default function AnnouncementsScreen() {
  const { session } = useAuth();
  const memberId = session?.user.id;
  const feedQuery = useAnnouncementsFeed(memberId);
  const groupsQuery = useGroups();
  const markRead = useMarkAnnouncementRead(memberId);

  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<
    number | null
  >(null);
  const markedIdsRef = useRef<Set<number>>(new Set());
  const inFlightIdsRef = useRef<Set<number>>(new Set());

  function handleOpenAnnouncement(announcement: AnnouncementPresentation) {
    setSelectedAnnouncementId(announcement.id);
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

  const rawAnnouncements = feedQuery.data ?? [];
  // Authors as Member Card buttons: one directory read for the whole feed.
  const authors = useMemberIdentities(
    rawAnnouncements.flatMap((row) => (row.created_by ? [row.created_by] : [])),
  );
  const announcements: AnnouncementPresentation[] = sortAnnouncements(
    rawAnnouncements.map((row) =>
      toAnnouncementPresentation(row, groupsQuery.data, authors.data),
    ),
  );

  const unreadCount = countUnreadAnnouncements(announcements);

  const unreadCritical = announcements.find(
    (a) => a.priority === 'critical' && !a.isRead,
  );

  const selectedAnnouncement =
    announcements.find((a) => a.id === selectedAnnouncementId) ?? null;

  const isPending = feedQuery.isPending || groupsQuery.isPending;

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

      {isPending ? (
        <Loading label="Se încarcă anunțurile…" />
      ) : feedQuery.isError ? (
        <ErrorState
          error={feedQuery.error}
          text="Nu am putut încărca anunțurile."
          onRetry={() => void feedQuery.refetch()}
        />
      ) : announcements.length === 0 ? (
        <Empty bare text="Nu sunt anunțuri disponibile în acest moment." />
      ) : (
        <div className="space-y-6">
          {unreadCritical && (
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
        onClose={() => setSelectedAnnouncementId(null)}
      />
    </Page>
  );
}
