import { Link } from 'react-router';
import { SessionScreen } from '../../components/shell/SessionScreen';
import { useAuth } from '../../lib/auth';
import { PrivacyNoticeContent } from './PrivacyNoticeContent';

/**
 * `/confidentialitate` (#771): the Privacy Notice, readable before sign-in
 * (the login screen links here) and after it (Profil links here). No guard:
 * the text is public and fetches nothing.
 */
export default function PrivacyNoticeScreen() {
  const { session } = useAuth();
  const back = session
    ? { to: '/profil', label: 'Înapoi la Profil' }
    : { to: '/login', label: 'Înapoi la conectare' };
  return (
    <SessionScreen wide>
      <Link
        to={back.to}
        className="self-start text-sm font-medium underline underline-offset-4"
      >
        {back.label}
      </Link>
      <PrivacyNoticeContent />
    </SessionScreen>
  );
}
