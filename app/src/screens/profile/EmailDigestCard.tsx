import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { SwitchRow } from '../../components/ui/switch';
import { useEmailDigest } from '../../queries/email-digest';

/** The anchor every digest's opt-out line links to (`/profil#rezumat-email`). */
export const EMAIL_DIGEST_ANCHOR = 'rezumat-email';

/**
 * **Rezumat zilnic pe email** (#775): one email a day, at 07:00, listing the
 * Notifications the Member has not read -- only on a day there is something
 * unread. The digest links back here, so turning the switch off is the
 * one-click opt-out, and it stops that day's email if it has not left yet.
 * The body of Profil's **Email zilnic** panel (#824): the page owns the
 * panel and its header, so the switch carries its own name.
 */
export function EmailDigestCard() {
  const digest = useEmailDigest();
  const sectionRef = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();

  // Arriving from the email's opt-out link: bring the switch into view.
  useEffect(() => {
    if (hash === `#${EMAIL_DIGEST_ANCHOR}`) {
      sectionRef.current?.scrollIntoView?.({ block: 'center' });
    }
  }, [hash]);

  return (
    <div
      ref={sectionRef}
      id={EMAIL_DIGEST_ANCHOR}
      data-testid="email-digest-card"
    >
      {/* One 44 px row: the label, what is on now, and the switch (X13). */}
      <SwitchRow
        label="Rezumat zilnic pe email"
        description={
          digest.enabled
            ? 'Primești dimineața, la 7, un email cu notificările necitite.'
            : 'Nu primești emailuri cu notificările necitite.'
        }
        checked={digest.enabled}
        disabled={digest.loading || digest.pending}
        onCheckedChange={(next) => digest.setEnabled(next)}
      />

      <p className="mt-2 text-sm text-muted-foreground">
        Doar în zilele în care ai ceva necitit. Lista din aplicație rămâne
        completă.
      </p>

      {digest.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {digest.error}
        </p>
      )}
    </div>
  );
}
