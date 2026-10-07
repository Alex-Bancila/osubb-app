import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { MemberName } from '../../components/member/MemberName';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { AnnouncementTermen } from '../announcements/AnnouncementTermen';
import { DealCodeStub } from './DealCodeStub';
import { DealLinkButtons } from './DealLinks';
import { isDealActive, type DealPresentation } from './deals-presentation';

type DealCardProps = {
  deal: DealPresentation;
  onOpen: (deal: DealPresentation) => void;
  /** Under the body on the team's page: who opened the code, the actions. */
  footerExtra?: ReactNode;
};

/**
 * One Deal (ruling R45): the Announcement card's quiet anatomy — a meta line,
 * the title with its date, the Termen, the body, the links, the author and
 * "Citește" — with the Deal Code torn off as a ticket stub, on the right from
 * 640 px and under the text on a phone. A Deal without a code has no stub.
 */
export default function DealCard({ deal, onOpen, footerExtra }: DealCardProps) {
  const titleId = `deal-title-${deal.id}`;
  const expired = !isDealActive(deal);

  return (
    <Card
      role="article"
      aria-labelledby={titleId}
      data-slot="deal-card"
      className="gap-0 py-0 sm:flex-row"
    >
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-bold tracking-[0.14em] text-accent-foreground uppercase">
            OSUBB Deals
          </span>
          {expired && <Badge variant="outline">Expirat</Badge>}
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

        <AnnouncementTermen deadline={deal.deadline} className="mt-2" />

        <p className="m-0 mt-2 line-clamp-3 text-sm text-muted-foreground">
          {deal.body}
        </p>

        {deal.links.length > 0 && (
          <div className="mt-3">
            <DealLinkButtons links={deal.links} />
          </div>
        )}

        {footerExtra}

        <div className="mt-auto flex items-center justify-between gap-3 pt-3 text-xs text-muted-foreground">
          <div className="flex min-w-0 items-center pointer-coarse:-my-1.5">
            {deal.authorMember && (
              <MemberName
                {...deal.authorMember}
                size="sm"
                className="text-xs text-foreground"
              />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpen(deal)}
            aria-label={`Citește deal-ul ${deal.title}`}
            className="-my-1.5 -mr-2 min-h-11 shrink-0 gap-1 text-xs text-primary"
          >
            <span>Citește</span>
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <DealCodeStub deal={deal} className="shrink-0 sm:w-60" />
    </Card>
  );
}
