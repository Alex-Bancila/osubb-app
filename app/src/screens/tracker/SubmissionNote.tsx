import { AttachedLinkButton } from '../../components/attached-link/AttachedLinkButton';
import {
  formatBucharestDay,
  formatBucharestTime,
} from '../../lib/calendar-time';
import { cn } from '../../lib/utils';
import type { TaskPresentation } from './task-presentation';

/**
 * The latest Submission Note (CONTEXT.md, ruling R7): the text the Executor
 * left for the reviewer and the link they attached, as plain text — no
 * Markdown, no link detection. `showTime` adds when it was sent, for the
 * details sheet, where an older note can outlive a return for changes.
 */
export function SubmissionNote({
  submission,
  showTime = false,
  className,
}: {
  submission: NonNullable<TaskPresentation['submission']>;
  showTime?: boolean;
  className?: string;
}) {
  return (
    <section
      aria-label="Notă la trimitere"
      data-slot="submission-note"
      className={cn(
        'min-w-0 space-y-2 rounded-lg border-l-2 border-primary/70 bg-muted/60 px-3 py-2.5',
        className,
      )}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Notă la trimitere
        {showTime && (
          <time
            dateTime={submission.submittedAt}
            className="font-normal tracking-normal normal-case"
          >
            {formatBucharestDay(submission.submittedAt)},{' '}
            {formatBucharestTime(submission.submittedAt)}
          </time>
        )}
      </p>
      {submission.note && (
        <p className="text-sm whitespace-pre-wrap wrap-anywhere">
          {submission.note}
        </p>
      )}
      {submission.link && (
        <AttachedLinkButton
          label={submission.link.label}
          url={submission.link.url}
          className="max-w-full text-left wrap-anywhere"
        />
      )}
    </section>
  );
}
