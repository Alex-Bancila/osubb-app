import { ExternalLink, LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { safeHttpUrl } from '../../lib/links';
import { FormattedText } from '../formatted-text/FormattedText';
import { Panel } from '../layout';
import { Badge } from '../ui/badge';
import { Button, buttonVariants } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

/** What every view of the Adherence Message (R66) shows. */
export type AdherenceMessageText = {
  title: string;
  /** Formatted Text (R60). */
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
};

/**
 * The two facts that brought the message: the Role and the Universitate. The
 * Role chip is the one Profil draws; neither confers anything.
 */
export function AdherenceMessageReasons({ className }: { className?: string }) {
  return (
    <div
      data-slot="adherence-message-reasons"
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      <span className="role-badge">
        <span className="role-dot" aria-hidden="true" />
        Voluntar Activ
      </span>
      <Badge variant="outline">Student UBB</Badge>
    </div>
  );
}

/**
 * The message's link as a button that opens a new tab. Opening it answers
 * nothing. An address the server would never have stored (not http(s)) is
 * not drawn at all.
 */
export function AdherenceMessageLink({
  url,
  label,
  variant = 'default',
  className,
}: {
  url: string | null;
  label: string | null;
  variant?: 'default' | 'outline';
  className?: string;
}) {
  const href = safeHttpUrl(url);
  if (!href || !label) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // A 60-character label wraps on a phone instead of overflowing.
      className={cn(
        buttonVariants({ variant }),
        'h-auto py-2.5 text-center whitespace-normal',
        className,
      )}
    >
      <span className="wrap-anywhere">{label}</span>
      <ExternalLink aria-hidden="true" />
      <span className="sr-only"> (se deschide într-o filă nouă)</span>
    </a>
  );
}

/**
 * The message in the app's dialog, centred over the dimmed app: the heading,
 * the Role and Universitate chips, the body, the link and **Am citit**.
 *
 * `mustAnswer` (the pop-up, decision 4): no X, and Escape or a tap outside do
 * nothing; only "Am citit" closes it, through `onAnswer`. Without it (BC's
 * preview) it closes as any dialog does.
 */
export function AdherenceMessageDialog({
  message,
  open,
  onOpenChange,
  mustAnswer = false,
  onAnswer,
  answering = false,
  error,
}: {
  message: AdherenceMessageText;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  mustAnswer?: boolean;
  onAnswer: () => void;
  answering?: boolean;
  /** Why the last answer failed, shown in the dialog (`role="alert"`). */
  error?: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (mustAnswer && !next) return;
        onOpenChange?.(next);
      }}
      disablePointerDismissal={mustAnswer}
    >
      {/* Its own marker: `data-slot` stays `dialog-content`, which the
          keyboard inset finds layers by. */}
      <DialogContent data-adherence-message="" showCloseButton={!mustAnswer}>
        <DialogHeader className={mustAnswer ? 'pr-0' : undefined}>
          <DialogTitle className="wrap-anywhere">{message.title}</DialogTitle>
        </DialogHeader>
        <AdherenceMessageReasons />
        <FormattedText text={message.body} view="full" />
        {error && (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <AdherenceMessageLink
            url={message.linkUrl}
            label={message.linkLabel}
          />
          <Button variant="outline" disabled={answering} onClick={onAnswer}>
            {answering && (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            Am citit
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Profil keeps the message once it is answered (decision 6): a panel titled
 * with its heading, the body and the link.
 */
export function AdherenceMessagePanel({
  message,
}: {
  message: AdherenceMessageText;
}) {
  return (
    <Panel
      title={<span className="wrap-anywhere">{message.title}</span>}
      stack={3}
    >
      <FormattedText text={message.body} view="full" className="max-w-[65ch]" />
      <AdherenceMessageLink
        url={message.linkUrl}
        label={message.linkLabel}
        variant="outline"
        className="self-start"
      />
    </Panel>
  );
}
