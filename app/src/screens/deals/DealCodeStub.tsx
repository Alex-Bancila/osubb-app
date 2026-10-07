import { useEffect, useRef, useState } from 'react';
import { Check, Copy, EyeOff } from 'lucide-react';
import { focusRingInsetClass } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useRevealDealCode } from '../../queries/deals';
import { dealCodeMask, type DealPresentation } from './deals-presentation';

type DealCodeStubProps = {
  deal: Pick<DealPresentation, 'id' | 'title' | 'code' | 'isRevealed'>;
  /** Torn off a card (the perforation and notches); false inside a sheet. */
  torn?: boolean;
  /** An expired Deal on the team's page: the stub still works, greyed. */
  muted?: boolean;
  /** After the server recorded the reveal (the card marks the Deal read). */
  onRevealed?: () => void;
  className?: string;
};

/**
 * The Deal Code as a ticket stub (ruling R45): the card's bottom strip, torn
 * off along a perforation (`.deal-stub` in screens.css). Hidden, it shows a
 * blurred, code-shaped mask — never the code — under "atinge ca să-l vezi",
 * and the whole stub is one button. Tapped, `reveal_deal_code` records the
 * reveal and answers the code, which shows large in monospace with Copiază and
 * a "Dezvăluit" stamp. A code the Member opened before, on any device, starts
 * revealed: the server remembers it, so it is asked for once.
 */
export function DealCodeStub({
  deal,
  torn = true,
  muted = false,
  onRevealed,
  className,
}: DealCodeStubProps) {
  const reveal = useRevealDealCode();
  // The code the reveal answered on this visit; a remembered reveal reads the row.
  const [answered, setAnswered] = useState<string | null>(null);
  // Animate only the reveal that happens here, not a remembered one.
  const [justRevealed, setJustRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const codeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  if (!deal.code) return null;

  const code = answered ?? (deal.isRevealed ? deal.code : null);
  const titleId = `deal-code-label-${deal.id}`;
  const eyebrowClass = muted
    ? 'text-muted-foreground'
    : 'text-accent-foreground';

  function open() {
    if (reveal.isPending) return;
    reveal.mutate(deal.id, {
      onSuccess: (value) => {
        setAnswered(value || deal.code);
        setJustRevealed(true);
        onRevealed?.();
        // The button is gone: keep the keyboard on the code it revealed.
        window.requestAnimationFrame(() => codeRef.current?.focus());
      },
    });
  }

  async function copy() {
    if (!code) return;
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <div
      data-slot="deal-code"
      data-state={code ? 'revealed' : 'hidden'}
      data-muted={muted || undefined}
      className={cn(
        torn && 'deal-stub',
        'min-w-0',
        muted ? 'bg-muted/70' : 'bg-accent/60 dark:bg-accent/35',
        // Revealed, the stub pads itself; hidden, the button fills it.
        code && 'px-4 py-3.5',
        className,
      )}
    >
      {code ? (
        <div
          role="group"
          aria-labelledby={titleId}
          className="flex flex-wrap items-end gap-x-5 gap-y-3"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-3">
              <p
                id={titleId}
                className={cn(
                  'm-0 text-[11px] font-bold tracking-[0.14em] uppercase',
                  eyebrowClass,
                )}
              >
                Cod OSUBB
              </p>
              {/* Stamped beside the label, as on a punched ticket. */}
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none inline-block rotate-[-8deg] rounded-sm border-2 border-current px-1.5 py-0.5 text-[10px] leading-none font-extrabold tracking-[0.18em] uppercase opacity-90',
                  muted ? 'text-muted-foreground' : 'text-primary',
                  justRevealed && 'deal-code-stamp',
                )}
              >
                Dezvăluit
              </span>
            </div>
            <p
              ref={codeRef}
              tabIndex={-1}
              aria-label={`Codul: ${code}`}
              className={cn(
                'm-0 font-mono text-2xl leading-tight font-bold tracking-[0.08em] break-all tabular-nums outline-none select-all sm:text-[1.65rem]',
                muted ? 'text-muted-foreground' : 'text-foreground',
                justRevealed && 'deal-code-revealed',
              )}
            >
              {code}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 gap-1.5 bg-background"
              onClick={() => void copy()}
            >
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copied ? 'Copiat' : 'Copiază'}
            </Button>
            <span role="status" className="sr-only">
              {copied ? 'Codul a fost copiat.' : ''}
            </span>
          </div>
          {copyFailed && (
            <p role="alert" className="m-0 basis-full text-xs text-destructive">
              Nu am putut copia. Selectează codul și copiază-l manual.
            </p>
          )}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={open}
            disabled={reveal.isPending}
            aria-busy={reveal.isPending || undefined}
            aria-label={`Arată codul OSUBB pentru ${deal.title}`}
            className={cn(
              'group/stub flex w-full flex-col gap-2 rounded-[inherit] px-4 py-3.5 text-left transition-colors disabled:cursor-progress motion-reduce:transition-none',
              muted
                ? 'hover:bg-muted'
                : 'hover:bg-accent/40 dark:hover:bg-accent/25',
              focusRingInsetClass,
            )}
          >
            <span
              className={cn(
                'text-[11px] font-bold tracking-[0.14em] uppercase',
                eyebrowClass,
              )}
            >
              {/* Wraps at the dot, never inside "să-l". */}
              Cod OSUBB ·{' '}
              <span className="whitespace-nowrap">atinge ca să-l vezi</span>
            </span>
            {/* A row of blurred characters, the pill on it: the code reads as
                covered, not as missing. As long as a code, not the stub. */}
            <span className="relative flex min-h-12 w-full items-center overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)] sm:max-w-sm">
              <span
                aria-hidden="true"
                className={cn(
                  'deal-code-mask font-mono text-2xl font-bold tracking-[0.22em] whitespace-nowrap',
                  muted ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {dealCodeMask(deal.id, 14) + dealCodeMask(deal.id + 1, 14)}
              </span>
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center"
              >
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-background shadow-(--sh-sm) transition-transform group-hover/stub:scale-105 motion-reduce:transition-none motion-reduce:group-hover/stub:scale-100',
                    muted ? 'bg-muted-foreground' : 'bg-foreground',
                  )}
                >
                  <EyeOff className="size-3.5" aria-hidden="true" />
                  {reveal.isPending ? 'Se deschide…' : 'Cod ascuns'}
                </span>
              </span>
            </span>
          </button>
          {reveal.isError && (
            <p
              role="alert"
              className="m-0 px-4 pb-3.5 text-xs text-destructive"
            >
              Nu am putut deschide codul. Încearcă din nou.
            </p>
          )}
        </>
      )}
    </div>
  );
}
