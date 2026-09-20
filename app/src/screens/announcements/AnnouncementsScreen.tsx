import { useRef, useState } from 'react';
import { useAuth } from '../../lib/auth';
import {
  useAnnouncementsFeed,
  useMarkAnnouncementRead,
} from '../../queries/announcements';
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
import { Empty, ErrorState, Loading } from '../../components/states';

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

  function handleOpenAnnouncement(announcement: AnnouncementPresentation) {
    setSelectedAnnouncementId(announcement.id);
    if (!announcement.isRead && !markedIdsRef.current.has(announcement.id)) {
      markedIdsRef.current.add(announcement.id);
      markRead.mutate(announcement.id);
    }
  }

  const rawAnnouncements = feedQuery.data ?? [];
  // Wave 2 stack / ADR-0009 bridge: announcements still carry dept_id, so the
  // Group is reached through the Wave 1 bridge column `groups.legacy_dept_id`.
  const groupByDeptId = new Map(
    [...(groupsQuery.data?.values() ?? [])]
      .filter((group) => group.legacy_dept_id !== null)
      .map((group) => [group.legacy_dept_id as string, group]),
  );

  const announcements: AnnouncementPresentation[] = sortAnnouncements(
    rawAnnouncements.map((row) =>
      toAnnouncementPresentation(row, groupByDeptId),
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
    <section
      className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8"
      aria-labelledby="announcements-title"
    >
      <header className="space-y-1">
        <h1
          id="announcements-title"
          className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
        >
          Anunțuri
        </h1>
        <p className="text-sm text-muted-foreground">
          {unreadCount === 0
            ? 'Toate anunțurile sunt citite'
            : unreadCount === 1
              ? '1 anunț necitit'
              : `${unreadCount} anunțuri necitite`}
        </p>
      </header>

      {isPending ? (
        <Loading label="Se încarcă anunțurile…" />
      ) : feedQuery.isError ? (
        <ErrorState
          error={feedQuery.error}
          text="Nu am putut încărca anunțurile."
          onRetry={() => void feedQuery.refetch()}
        />
      ) : announcements.length === 0 ? (
        <Empty text="Nu sunt anunțuri disponibile în acest moment." />
      ) : (
        <div className="space-y-6">
          {unreadCritical && (
            <CriticalAnnouncementBanner
              announcement={unreadCritical}
              onOpen={handleOpenAnnouncement}
            />
          )}

          <ul className="space-y-4" role="list" aria-label="Flux de anunțuri">
            {announcements.map((announcement) => (
              <li key={announcement.id}>
                <AnnouncementCard
                  announcement={announcement}
                  onOpen={handleOpenAnnouncement}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <AnnouncementDetailsSheet
        announcement={selectedAnnouncement}
        onClose={() => setSelectedAnnouncementId(null)}
      />
    </section>
  );
}
