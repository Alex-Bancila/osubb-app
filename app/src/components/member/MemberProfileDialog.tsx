import { useState, type ReactNode } from 'react';
import { MailIcon, PhoneIcon } from 'lucide-react';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MemberAvatar } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatPoints } from '@/lib/format';
import { useMemberProfile } from '@/queries/member-profile';

type MemberIdentity = {
  memberId: string;
  /** Shown straight away, before the profile read answers. */
  name: string;
  avatarColor?: string | null;
  /** Only when the caller already holds a total the viewer may see. */
  points?: number;
};

/**
 * A small pop-up with one member's profile: name, avatar, role, Groups and —
 * when the viewer may read them — contact details. Opened from anywhere a
 * member is named (a Candidate in a queue, a row in the directory).
 */
export function MemberProfileDialog({
  memberId,
  name,
  avatarColor,
  points,
  open,
  onOpenChange,
}: MemberIdentity & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <MemberProfileBody
          memberId={memberId}
          name={name}
          avatarColor={avatarColor}
          points={points}
        />
      </DialogContent>
    </Dialog>
  );
}

// Mounted only while the Dialog is open, so a list of fifty names does not
// read fifty profiles.
function MemberProfileBody({
  memberId,
  name,
  avatarColor,
  points,
}: MemberIdentity) {
  const profile = useMemberProfile(memberId);
  const data = profile.data;
  const displayName = data?.fullName ?? name;
  return (
    <>
      <DialogHeader className="flex-row items-center gap-3">
        <MemberAvatar
          name={displayName}
          avatarColor={data?.avatarColor ?? avatarColor}
          className="size-12 text-sm"
        />
        <div className="min-w-0 space-y-0.5">
          <DialogTitle className="truncate">{displayName}</DialogTitle>
          <DialogDescription>
            {[
              data?.roleLabel,
              data?.joinedYear ? `Membru din ${data.joinedYear}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Profil de membru'}
          </DialogDescription>
        </div>
      </DialogHeader>

      {points !== undefined && (
        <p className="text-sm">
          <span className="font-semibold">{formatPoints(points)}</span>{' '}
          <span className="text-muted-foreground">puncte</span>
        </p>
      )}

      {profile.isPending ? (
        <p role="status" className="text-muted-foreground">
          Se încarcă profilul…
        </p>
      ) : profile.isError || !data ? (
        <div role="alert" className="space-y-2">
          <p>Nu am putut încărca profilul.</p>
          <Button variant="outline" onClick={() => void profile.refetch()}>
            Reîncarcă profilul
          </Button>
        </div>
      ) : (
        <>
          {data.groups.length > 0 && (
            <section aria-labelledby={`member-${memberId}-groups`}>
              <h3
                id={`member-${memberId}-groups`}
                className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
              >
                Grupuri
              </h3>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                {data.groups.map((group) => (
                  <li
                    key={group.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: group.color ?? 'var(--brand-red)',
                        }}
                      />
                      <span className="truncate">{group.label}</span>
                    </span>
                    <Badge variant="outline">{group.role_label}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(data.email || data.phone) && (
            <section aria-labelledby={`member-${memberId}-contact`}>
              <h3
                id={`member-${memberId}-contact`}
                className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase"
              >
                Contact
              </h3>
              <ul className="space-y-1">
                {data.email && (
                  <li>
                    <a
                      href={`mailto:${data.email}`}
                      className="inline-flex min-h-11 items-center gap-2 break-all underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <MailIcon aria-hidden="true" className="size-4" />
                      {data.email}
                    </a>
                  </li>
                )}
                {data.phone && (
                  <li>
                    <a
                      href={`tel:${data.phone}`}
                      className="inline-flex min-h-11 items-center gap-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <PhoneIcon aria-hidden="true" className="size-4" />
                      {data.phone}
                    </a>
                  </li>
                )}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

/**
 * The member's avatar (and, optionally, a label) as a button that opens their
 * profile. Its accessible name always says whose profile it opens.
 */
export function MemberProfileButton({
  children,
  className,
  ...identity
}: MemberIdentity & { children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className={cn('gap-2 px-2', className)}
        aria-label={`Profilul membrului ${identity.name}`}
        onClick={() => setOpen(true)}
      >
        <MemberAvatar name={identity.name} avatarColor={identity.avatarColor} />
        {children}
      </Button>
      <MemberProfileDialog {...identity} open={open} onOpenChange={setOpen} />
    </>
  );
}
