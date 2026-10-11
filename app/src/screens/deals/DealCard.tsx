import type { ReactNode } from 'react';
import { AttachedLinksList } from '../../components/attached-link/AttachedLinksList';
import { Card, CardContent, CardFooter } from '../../components/ui/card';
import { cn } from '../../lib/utils';
import {
  AnnouncementByline,
  cardOpenButtonClass,
} from '../announcements/AnnouncementByline';
import { AnnouncementTermen } from '../announcements/AnnouncementTermen';
import { DealCodeStub } from './DealCodeStub';
import { isDealActive, type DealPresentation } from './deals-presentation';

type DealCardProps = {
  deal: DealPresentation;
  onOpen: (deal: DealPresentation) => void;
  /** On the team's page, in the footer row: how many opened the code. */
  footerMeta?: ReactNode;
  /** On the team's page, at the footer row's end: Editează and Șterge. */
  footerActions?: ReactNode;
  /** The code was revealed from this card: the Deal counts as read. */
  onRevealed?: (deal: DealPresentation) => void;
};

/**
 * One Deal (ruling R45), on the Announcement card's quiet anatomy: the title,
 * the author and the date on one muted line under it, the Termen as an icon
 * line, the body and the links. The whole card opens the Deal — the title is
 * the button, its hit area the card — and everything else to press sits above
 * it. Only the team's page adds a footer row: how many opened the code, then
 * the actions. Under it, at every width, the Deal Code is torn off along a
 * perforation as a ticket stub; a Deal without a code has none. An expired
 * Deal (the team's page only) keeps its stub, muted.
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
  const hasFooter = Boolean(footerMeta) || Boolean(footerActions);

  return (
    <Card
      role="article"
      aria-labelledby={titleId}
      data-slot="deal-card"
      data-expired={expired || undefined}
      // The stub's notches cut through the card's edge, so the card does not
      // clip: the footer and the stub round their own corners.
      className={cn(
        'pressable relative gap-0 overflow-visible hover:ring-foreground/25',
        hasStub && 'pb-0',
      )}
    >
      <CardContent className={cn((hasStub || hasFooter) && 'pb-4')}>
        <div className="flex min-w-0 items-start gap-2">
          <h3 className="m-0 min-w-0 font-heading text-base leading-snug font-semibold tracking-tight text-foreground sm:text-lg">
            <button
              type="button"
              data-slot="card-open"
              onClick={() => onOpen(deal)}
              aria-label={`Citește deal-ul ${deal.title}`}
              className={cardOpenButtonClass}
            >
              <span id={titleId}>{deal.title}</span>
            </button>
          </h3>
          {!deal.isRead && (
            <span className="mt-2 ml-auto inline-flex shrink-0 items-center pl-1">
              <span
                className="size-2 rounded-full bg-destructive"
                aria-hidden="true"
              />
              <span className="sr-only">Necitit</span>
            </span>
          )}
        </div>
        <AnnouncementByline
          author={deal.authorMember}
          publishedAt={deal.publishedAt}
          publishedLabel={deal.publishedLabel}
          className="mt-1"
        />

        {/* "Termen expirat" is the expired mark: no badge repeats it. */}
        <AnnouncementTermen deadline={deal.deadline} className="mt-2" />

        <p className="m-0 mt-2 line-clamp-3 text-sm text-muted-foreground">
          {deal.body}
        </p>

        <AttachedLinksList
          links={deal.links}
          variant="card"
          className="mt-3"
          buttonClassName="relative z-1 max-w-full text-left wrap-anywhere"
        />
      </CardContent>

      {hasFooter && (
        <CardFooter
          className={cn(
            'flex-wrap justify-between gap-x-3 gap-y-1 py-3 text-xs text-muted-foreground',
            hasStub && 'rounded-b-none',
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {footerMeta}
          </div>
          {footerActions && (
            <div className="relative z-1 -my-1.5 -mr-2 ml-auto flex flex-wrap items-center justify-end">
              {footerActions}
            </div>
          )}
        </CardFooter>
      )}

      <DealCodeStub
        deal={deal}
        muted={expired}
        // Above the card's own tap target: the stub is its own button.
        className="z-1 rounded-b-md"
        onRevealed={() => onRevealed?.(deal)}
      />
    </Card>
  );
}
