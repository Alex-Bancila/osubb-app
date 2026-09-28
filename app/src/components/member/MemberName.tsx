import { useState } from 'react';
import { cn } from 'cn';
import { MemberAvatar } from '@/components/ui/combobox';
import { MemberCard } from './MemberCard';
import { memberDisplayName, type MemberIdentity } from './member-identity';

/**
 * The one way to name a Member in the interface: their avatar and Nickname
 * (the full name when they chose none) as a button that opens their Member
 * Card. `showFullName` adds the full name underneath, for the Voluntari and
 * Administrare lists (ruling R5). There is deliberately no `points` prop — the
 * card never shows points or rank.
 */
export function MemberName({
  showFullName = false,
  size = 'default',
  wrap = false,
  avatarFallback,
  className,
  ...identity
}: MemberIdentity & {
  showFullName?: boolean;
  /** The avatar's colour when the Member has no usable one of their own. */
  avatarFallback?: string;
  /**
   * `sm` for dense rows: a smaller avatar and type, as tall as its text with
   * a mouse and a 44 px target on a touch screen. (`min-h-9` is 56 px in this
   * app's spacing scale, so no step of it is used here.)
   */
  size?: 'default' | 'sm';
  /**
   * Let the name wrap onto more lines instead of cutting it with "…", for a
   * ranked row where the name is the thing read (layout L1).
   */
  wrap?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const name = memberDisplayName(identity.nickname, identity.fullName);
  const fullNameLine = showFullName && name !== identity.fullName;
  return (
    <>
      <button
        type="button"
        data-slot="member-name"
        aria-label={`Profilul membrului ${name}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          'group/member inline-flex max-w-full min-w-0 items-center rounded-md text-left align-middle outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring',
          size === 'sm'
            ? 'gap-1.5 text-sm pointer-coarse:min-h-11'
            : 'min-h-11 gap-2',
          className,
        )}
      >
        <MemberAvatar
          name={identity.fullName}
          avatarColor={identity.avatarColor}
          fallbackColor={avatarFallback}
          className={size === 'sm' ? 'size-6 text-[0.6rem]' : undefined}
        />
        <span className="grid min-w-0">
          <span
            data-slot="member-name-text"
            className={cn(
              'font-semibold underline-offset-4 decoration-foreground/30 group-hover/member:underline',
              wrap ? 'wrap-break-word' : 'truncate',
            )}
          >
            {name}
          </span>
          {fullNameLine && (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {identity.fullName}
            </span>
          )}
        </span>
      </button>
      <MemberCard {...identity} open={open} onOpenChange={setOpen} />
    </>
  );
}
