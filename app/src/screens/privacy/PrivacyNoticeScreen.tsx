import { BackLink } from '../../components/layout';
import { SessionScreen } from '../../components/shell/SessionScreen';
import { useAuth } from '../../lib/auth';
import { PrivacyNoticeContent } from './PrivacyNoticeContent';

/**
 * `/confidentialitate` (#771): the Privacy Notice, readable before sign-in
 * (the login screen links here) and after it (Profil and Administrare link
 * here). No guard: the text is public and fetches nothing.
 */
export default function PrivacyNoticeScreen() {
  const { session, claims } = useAuth();
  // The link that opened the notice wins (`state.from`, read by BackLink):
  // Administrare → Confidențialitate comes back there (navigation D15).
  // Otherwise: Profil for a member, the no-profile screen for a session
  // without claims (Profil would only bounce it there), sign-in without one.
  const back = !session
    ? { to: '/login', label: 'Înapoi la conectare' }
    : claims
      ? { to: '/profil', label: 'Înapoi la Profil' }
      : { to: '/no-profile', label: 'Înapoi' };
  return (
    <SessionScreen wide>
      <BackLink to={back.to} label={back.label} />
      <PrivacyNoticeContent />
    </SessionScreen>
  );
}
