import { AttachedLinkButton } from '../../components/attached-link/AttachedLinkButton';

/**
 * **Aplică** for a Group with a form link (#698, ruling R18): the Attached
 * Link, opening the form in a new tab. No in-app Application is filed, so
 * there is no dialog, no pending badge and nothing to withdraw — the Group's
 * Responsibles read the answers and Appoint the Member from the Roster.
 */
export function ApplicationFormLink({
  label,
  url,
}: {
  label: string;
  url: string;
}) {
  return (
    <div className="space-y-2">
      <AttachedLinkButton label={label} url={url} />
      <p className="text-sm text-muted-foreground">
        Înscrierea se face prin formular; responsabilii grupului te adaugă după
        ce răspunzi.
      </p>
    </div>
  );
}
