import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useTaskLeadership } from '../../queries/task-tabs';
import { Button } from '../../components/ui/button';

/** The route checks claims; this live capability also catches stale claims. */
export function LeadershipAccess({ children }: { children: ReactNode }) {
  const access = useTaskLeadership();
  if (access.isPending) return <p role="status">Se verifică accesul…</p>;
  if (access.isError)
    return (
      <div role="alert">
        <p>Nu am putut verifica accesul.</p>
        <Button onClick={() => access.refetch()}>Încearcă din nou</Button>
      </div>
    );
  if (!access.data)
    return <Navigate to="/" replace state={{ leadershipDenied: true }} />;
  return children;
}
