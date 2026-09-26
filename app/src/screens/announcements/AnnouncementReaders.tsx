import { useState } from 'react';
import { Eye } from 'lucide-react';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useAuth } from '../../lib/auth';
import { useCapability } from '../../lib/capabilities';
import { useAnnouncementReaders } from '../../queries/announcements';
import { useMyGroupRoles } from '../../queries/my-groups';
import {
  formatAnnouncementDate,
  mayAskForReaders,
  readersSummary,
  type AnnouncementPresentation,
  type AnnouncementReader,
} from './announcements-presentation';

const sectionHeading =
  'mb-1 text-[0.7rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase';

/**
 * "Citit de x din y" and the readers list (R15). Rendered only when the server
 * answers `announcement_readers` with rows: a PT404 means the viewer may not
 * see them, and the line is simply absent.
 */
export default function AnnouncementReaders({
  announcement,
}: {
  announcement: AnnouncementPresentation;
}) {
  const { session } = useAuth();
  const bcOrModerator = useCapability('manageRoles').data === true;
  const myGroups = useMyGroupRoles();
  const allowed = mayAskForReaders(announcement, {
    memberId: session?.user.id,
    bcOrModerator,
    groups: myGroups.data,
  });
  const readers = useAnnouncementReaders(announcement.id, allowed);
  const [open, setOpen] = useState(false);

  if (!allowed) return null;
  if (readers.isError)
    return (
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Nu am putut încărca cine a citit anunțul.
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11"
          onClick={() => void readers.refetch()}
        >
          Reîncearcă
        </Button>
      </p>
    );
  if (!readers.data || readers.data.length === 0) return null;

  const summary = readersSummary(readers.data);
  const share = summary.read.length / readers.data.length;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Eye className="size-4 shrink-0 text-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-semibold text-foreground">
            {summary.label}
          </p>
          <div
            className="h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </div>
        </div>
      </div>
      <Button
        variant="outline"
        className="min-h-11"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Vezi cine a citit
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cine a citit</DialogTitle>
            <DialogDescription>{summary.label}</DialogDescription>
          </DialogHeader>
          <div className="-mx-4 space-y-5 overflow-y-auto px-4">
            <ReaderSection
              title="Au citit"
              readers={summary.read}
              empty="Nimeni nu l-a deschis încă."
            />
            {summary.unread.length > 0 && (
              <ReaderSection
                title="Nu au citit încă"
                readers={summary.unread}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReaderSection({
  title,
  readers,
  empty,
}: {
  title: string;
  readers: AnnouncementReader[];
  empty?: string;
}) {
  return (
    <section aria-label={`${title} (${readers.length})`}>
      <h3 className={sectionHeading}>
        {title} · {readers.length}
      </h3>
      {readers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {readers.map((reader) => (
            <li
              key={reader.member.memberId}
              className="flex min-w-0 items-center justify-between gap-3 py-0.5"
            >
              <MemberName {...reader.member} size="sm" />
              {reader.readAt && (
                <time
                  dateTime={reader.readAt}
                  className="shrink-0 text-xs text-muted-foreground tabular-nums"
                >
                  {formatAnnouncementDate(reader.readAt)}
                </time>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
