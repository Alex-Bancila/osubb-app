import { useEffect, useRef, useState } from 'react';
import { Check, Copy, EyeOff } from 'lucide-react';
import { focusRingClass } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useRevealDealCode } from '../../queries/deals';
import { dealCodeMask, type DealPresentation } from './deals-presentation';

type DealCodeStubProps = {
  deal: Pick<DealPresentation, 'id' | 'title' | 'code' | 'isRevealed'>;
  /** Torn off a card (the perforation and notches); false inside a sheet. */
  torn?: boolean;
  /** After the server recorded the reveal (the card marks the Deal read). */
  onRevealed?: () => void;
  className?: string;
};

/**
 * The Deal Code as a ticket stub (ruling R45): torn off the card along a
 * dashed perforation (`.deal-stub` in screens.css). Hidden, it shows a
 * blurred, code-shaped mask — never the code — under "atinge ca să-l vezi",
 * and the whole stub is one button. Tapped, `reveal_deal_code` records the
 * reveal and answers the code, which shows large in monospace with Copiază and
 * a "Dezvăluit" stamp. A code the Member opened before, on any device, starts
 * revealed: the server remembers it, so it is asked for once.
 */
export function DealCodeStub({
  deal,
  torn = true,
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
      className={cn(
        torn && 'deal-stub',
        'flex min-w-0 flex-col justify-center bg-accent/60 px-4 py-4 dark:bg-accent/40',
        className,
      )}
    >
      {code ? (
        <div
          role="group"
          aria-labelledby={titleId}
          className="relative flex flex-col gap-3"
        >
          <p
            id={titleId}
            className="m-0 text-[11px] font-bold tracking-[0.14em] text-accent-foreground uppercase"
          >
            Cod OSUBB
          </p>
          <p
            ref={codeRef}
            tabIndex={-1}
            aria-label={`Codul: ${code}`}
            className={cn(
              'm-0 font-mono text-2xl leading-tight font-bold tracking-[0.08em] break-all text-foreground tabular-nums outline-none select-all sm:text-[1.65rem]',
              justRevealed && 'deal-code-revealed',
            )}
          >
            {code}
          </p>
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute top-0 right-0 rotate-[-8deg] rounded-sm border-2 border-current px-1.5 py-0.5 text-[10px] font-extrabold tracking-[0.18em] text-primary uppercase opacity-90',
              justRevealed && 'deal-code-stamp',
            )}
          >
            Dezvăluit
          </span>
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
            <p role="alert" className="m-0 text-xs text-destructive">
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
              'group/stub flex w-full flex-col gap-2.5 rounded-sm text-left disabled:cursor-progress',
              focusRingClass,
            )}
          >
            <span className="text-[11px] font-bold tracking-[0.14em] text-accent-foreground uppercase">
              {/* Wraps at the dot, never inside "să-l". */}
              Cod OSUBB ·{' '}
              <span className="whitespace-nowrap">atinge ca să-l vezi</span>
            </span>
            {/* A row of blurred characters across the stub, the pill on it:
                at every width the code reads as covered, not as missing. */}
            <span className="relative flex min-h-12 w-full items-center overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)]">
              <span
                aria-hidden="true"
                className="deal-code-mask font-mono text-2xl font-bold tracking-[0.22em] whitespace-nowrap text-foreground"
              >
                {dealCodeMask(deal.id, 14) + dealCodeMask(deal.id + 1, 14)}
              </span>
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background shadow-(--sh-sm) transition-transform group-hover/stub:scale-105 motion-reduce:transition-none">
                  <EyeOff className="size-3.5" aria-hidden="true" />
                  {reveal.isPending ? 'Se deschide…' : 'Cod ascuns'}
                </span>
              </span>
            </span>
          </button>
          {reveal.isError && (
            <p role="alert" className="m-0 mt-2 text-xs text-destructive">
              Nu am putut deschide codul. Încearcă din nou.
            </p>
          )}
        </>
      )}
    </div>
  );
}
