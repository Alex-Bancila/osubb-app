import { BanIcon, CheckIcon } from 'lucide-react';
import {
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cn } from 'cn';

import { Input } from '@/components/ui/input';
import { SegmentedRadio } from '@/components/ui/segmented-radio';
import {
  hexToHsv,
  hsvToHex,
  OSUBB_COLORS,
  type Hsv,
  type NamedColor,
} from '@/lib/color';

type Tab = 'brand' | 'custom';

const TABS = [
  { value: 'brand', label: 'OSUBB' },
  { value: 'custom', label: 'Personalizată' },
] as const;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The app's colour chooser (an avatar's colour, a Group's): a two-segment
 * switch between **OSUBB** — the Brand Book's colours as one row of swatches
 * — and **Personalizată**, any colour: a saturation/brightness pad, a hue
 * slider and the `#RRGGBB` code. The value is always `#RRGGBB`, or `''` when
 * none is chosen yet. It opens on OSUBB unless the value is a colour of its
 * own.
 *
 * The swatches are a group of `aria-pressed` buttons named by their colour;
 * the pad moves with the pointer or the arrow keys, and typing a code sets
 * the colour exactly.
 */
export function ColorPicker({
  value,
  onChange,
  label,
  colors = OSUBB_COLORS,
  noneLabel,
  disabled = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The swatch group's accessible name ("Alege culoarea avatarului"). */
  label: string;
  colors?: readonly NamedColor[];
  /**
   * For an optional colour: the name of a first, empty swatch that sets the
   * value back to `''` ("Fără culoare").
   */
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const isBrand = value === '' || colors.some((c) => same(c.color, value));
  const [tab, setTab] = useState<Tab>(isBrand ? 'brand' : 'custom');
  // The pad's own position: a grey has no hue of its own, so the hue last
  // chosen is kept here rather than re-read from the colour.
  const [hsv, setHsv] = useState<Hsv>(
    () => hexToHsv(value) ?? { h: 0, s: 0.85, v: 0.9 },
  );
  const [code, setCode] = useState(value.toUpperCase());
  // A value set from outside (the form resets, a swatch) moves the pad too.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setCode(value.toUpperCase());
    const next = hexToHsv(value);
    if (next && !same(hsvToHex(hsv), value)) setHsv(next);
  }

  function pick(next: Hsv) {
    setHsv(next);
    onChange(hsvToHex(next));
  }

  function fromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    pick({
      h: hsv.h,
      s: clamp((event.clientX - box.left) / box.width),
      v: clamp(1 - (event.clientY - box.top) / box.height),
    });
  }

  function onPadKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = 0.02;
    const move: Record<string, Partial<Hsv>> = {
      ArrowLeft: { s: Math.max(0, hsv.s - step) },
      ArrowRight: { s: Math.min(1, hsv.s + step) },
      ArrowUp: { v: Math.min(1, hsv.v + step) },
      ArrowDown: { v: Math.max(0, hsv.v - step) },
    };
    const next = move[event.key];
    if (!next) return;
    event.preventDefault();
    pick({ ...hsv, ...next });
  }

  return (
    <div data-slot="color-picker" className={cn('grid gap-3', className)}>
      <SegmentedRadio
        aria-label="Sursa culorii"
        options={TABS}
        value={tab}
        onValueChange={setTab}
        disabled={disabled}
      />
      {tab === 'brand' ? (
        // One row at every width: 40 px discs in 44 px targets that share
        // the row and shrink together on a narrow sheet; the selection is a
        // ring, never a size change.
        <div
          role="group"
          aria-label={label}
          className="grid w-full max-w-[20.75rem] gap-1"
          style={{
            gridTemplateColumns: `repeat(${colors.length + (noneLabel ? 1 : 0)}, minmax(0, 1fr))`,
          }}
        >
          {noneLabel && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange('')}
              aria-label={noneLabel}
              aria-pressed={value === ''}
              className="group grid aspect-square w-full max-w-11 min-w-0 cursor-pointer place-items-center rounded-full outline-none"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid aspect-square w-[calc(100%-4px)] max-w-10 place-items-center rounded-full border border-dashed border-ink-400 text-muted-foreground ring-offset-2 ring-offset-card transition-shadow group-focus-visible:ring-3 group-focus-visible:ring-ring motion-reduce:transition-none',
                  value === ''
                    ? 'ring-2 ring-foreground'
                    : 'group-hover:ring-2 group-hover:ring-border',
                )}
              >
                <BanIcon className="size-4" />
              </span>
            </button>
          )}
          {colors.map((swatch) => {
            const selected = same(swatch.color, value);
            return (
              <button
                key={swatch.color}
                type="button"
                disabled={disabled}
                onClick={() => onChange(swatch.color)}
                aria-label={swatch.name}
                aria-pressed={selected}
                className="group grid aspect-square w-full max-w-11 min-w-0 cursor-pointer place-items-center rounded-full outline-none"
              >
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: swatch.color }}
                  className={cn(
                    'grid aspect-square w-[calc(100%-4px)] max-w-10 place-items-center rounded-full text-white ring-offset-2 ring-offset-card transition-shadow group-focus-visible:ring-3 group-focus-visible:ring-ring motion-reduce:transition-none',
                    selected
                      ? 'ring-2 ring-foreground'
                      : 'group-hover:ring-2 group-hover:ring-border',
                  )}
                >
                  {selected && <CheckIcon className="size-4 stroke-[3]" />}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3">
          <div
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="Saturație și luminozitate"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            aria-valuetext={`${hsvToHex(hsv)}: saturație ${Math.round(hsv.s * 100)}%, luminozitate ${Math.round(hsv.v * 100)}%`}
            aria-disabled={disabled || undefined}
            data-slot="color-pad"
            onPointerDown={(event) => {
              if (disabled) return;
              event.currentTarget.setPointerCapture?.(event.pointerId);
              fromPointer(event);
            }}
            onPointerMove={(event) => {
              if (!disabled && event.buttons === 1) fromPointer(event);
            }}
            onKeyDown={onPadKey}
            className="relative h-28 w-full cursor-crosshair touch-none rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring"
            style={{
              backgroundImage: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
            }}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgb(0_0_0/0.45)]"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                backgroundColor: hsvToHex(hsv),
              }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={Math.round(hsv.h)}
            disabled={disabled}
            aria-label="Nuanță"
            onChange={(event) =>
              pick({ ...hsv, h: Number(event.target.value) })
            }
            className="h-4 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-transparent [&::-moz-range-thumb]:shadow-[0_0_0_1px_rgb(0_0_0/0.45)] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgb(0_0_0/0.45)]"
            style={{
              backgroundImage:
                'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
            }}
          />
          <label className="flex items-center gap-3 text-sm">
            <span
              aria-hidden="true"
              className="size-9 shrink-0 rounded-full ring-1 ring-border"
              style={{ backgroundColor: hsvToHex(hsv) }}
            />
            <span className="sr-only">Codul culorii</span>
            <Input
              value={code}
              disabled={disabled}
              spellCheck={false}
              autoCapitalize="characters"
              maxLength={7}
              placeholder="#RRGGBB"
              aria-invalid={code !== '' && hexToHsv(code) === null}
              onChange={(event) => {
                const text = event.target.value.trim();
                setCode(text.toUpperCase());
                const parsed = hexToHsv(text);
                if (!parsed) return;
                setHsv(parsed);
                onChange(hsvToHex(parsed));
              }}
              className="w-32 font-mono tabular-nums"
            />
          </label>
        </div>
      )}
    </div>
  );
}
