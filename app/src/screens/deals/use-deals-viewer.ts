import { useAuth } from '../../lib/auth';
import { useCapabilities } from '../../lib/capabilities';
import type { DealsViewer } from './deals-presentation';

/** The viewer as the Deal screens judge them, from the live capability row. */
export function useDealsViewer(): DealsViewer {
  const memberId = useAuth().session?.user.id;
  const capabilities = useCapabilities().data;
  return {
    memberId,
    manageDeals: capabilities?.manageDeals === true,
    manageDealsTeam: capabilities?.manageDealsTeam === true,
    bcOrModerator: capabilities?.manageRoles === true,
  };
}
