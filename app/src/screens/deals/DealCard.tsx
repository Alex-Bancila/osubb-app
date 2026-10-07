import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { MemberName } from '../../components/member/MemberName';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardFooter } from '../../components/ui/card';
import { cn } from '../../lib/utils';
import { AnnouncementTermen } from '../announcements/AnnouncementTermen';
import { DealCodeStub } from './DealCodeStub';
import { AttachedLinksList } from '../../components/attached-link/AttachedLinksList';
import { isDealActive, type DealPresentation } from './deals-presentation';

type DealCardProps = {
  deal: DealPresentation;
  onOpen: (deal: DealPresentation) => void;
  /** Beside the author on the team's page: how many opened the code. */
  footerMeta?: ReactNode;
  /** Before "Citește" on the team's page: Editează and Șterge. */
  footerActions?: ReactNode;
  /** The code was revealed from this card: the Deal counts as read. */
  onRevealed?: (deal: DealPresentation) => void;
};

/**
 * One Deal (ruling R45), on the Announcement card's quiet anatomy: the
 * "OSUBB Deals" eyebrow, the title with its date, the Termen as a chip of its
 * own width, the body, the links, and one footer row — the author (and, for
 * the team, how many opened the code and the actions) left of "Citește".
 * Under it, at every width, the Deal Code is torn off along a perforation as
 * a ticket stub; a Deal without a code has none. An expired Deal (the team's
 * page only) keeps its stub, muted.
 */
export default function DealCard({
  deal,
  onOpen,
  footerMeta,
  footerActions,
  onRevealed,
}: DealCardProps) {
  const titleId = `deal-title-${deal.id}`;
  const expired = !isDealActive(deal);
  const hasStub = deal.code !== null;

  return (
    <Card
      role="article"
      aria-labelledby={titleId}
      data-slot="deal-card"
      data-expired={expired || undefined}
      // The stub's notches cut through the card's edge, so the card does not
      // clip: the footer and the stub round their own corners.
      className="gap-0 overflow-visible"
    >
      <CardContent className="pb-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-bold tracking-[0.14em] text-accent-foreground uppercase">
            OSUBB Deals
          </span>
          {!deal.isRead && (
            <span className="ml-auto inline-flex shrink-0 items-center pl-1">
              <span
                className="size-2 rounded-full bg-destructive"
                aria-hidden="true"
              />
              <span className="sr-only">Necitit</span>
            </span>
          )}
        </div>

        <h3
          id={titleId}
          className="m-0 mt-2 font-heading text-base leading-snug font-semibold tracking-tight text-foreground sm:text-lg"
        >
          {deal.title}
        </h3>
        <time
          dateTime={deal.publishedAt}
          className="mt-0.5 block text-xs text-muted-foreground"
        >
          {deal.publishedLabel}
        </time>

        {/* "Termen expirat" is the expired mark: no badge repeats it. */}
        <AnnouncementTermen deadline={deal.deadline} className="mt-2" />

        <p className="m-0 mt-2 line-clamp-3 text-sm text-muted-foreground">
          {deal.body}
        </p>

        <AttachedLinksList
          links={deal.links}
          variant="card"
          className="mt-3"
          buttonClassName="max-w-full text-left wrap-anywhere"
        />
      </CardContent>

      <CardFooter
        className={cn(
          'flex-wrap justify-between gap-x-3 gap-y-1 py-3 text-xs text-muted-foreground',
          hasStub && 'rounded-b-none',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pointer-coarse:-my-1.5">
          {deal.authorMember && (
            <MemberName
              {...deal.authorMember}
              size="sm"
              className="text-xs text-foreground"
            />
          )}
          {footerMeta}
        </div>
        <div className="-my-1.5 -mr-2 ml-auto flex flex-wrap items-center justify-end">
          {footerActions}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpen(deal)}
            aria-label={`Citește deal-ul ${deal.title}`}
            className="min-h-11 shrink-0 gap-1 text-xs text-primary"
          >
            <span>Citește</span>
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </CardFooter>

      <DealCodeStub
        deal={deal}
        muted={expired}
        className="rounded-b-md"
        onRevealed={() => onRevealed?.(deal)}
      />
    </Card>
  );
}
