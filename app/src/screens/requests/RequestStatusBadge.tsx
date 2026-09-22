import {
  CheckCircle2,
  Hourglass,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';

type RequestStatus = 'pending' | 'approved' | 'rejected';

// Each state carries an icon, a colour and its word, so it reads the same to
// someone who cannot tell the colours apart. Text colours are the darker
// brand shades that keep 4.5:1 on their own tint in both themes.
const statuses: Record<
  RequestStatus,
  { label: string; icon: LucideIcon; className: string }
> = {
  pending: {
    label: 'În așteptare',
    icon: Hourglass,
    className:
      'border-[var(--warning)] bg-[var(--warning-050)] text-foreground',
  },
  approved: {
    label: 'Aprobată',
    icon: CheckCircle2,
    className:
      'border-[var(--success)] bg-[var(--success-050)] text-[var(--success)]',
  },
  rejected: {
    label: 'Respinsă',
    icon: XCircle,
    className: 'border-red-700 bg-[var(--danger-050)] text-red-700',
  },
};

function requestStatus(status: string): RequestStatus {
  return status === 'approved' || status === 'rejected' ? status : 'pending';
}

export function RequestStatusBadge({ status }: { status: string }) {
  const { label, icon: Icon, className } = statuses[requestStatus(status)];
  return (
    <Badge
      variant="outline"
      data-status={requestStatus(status)}
      className={cn('h-6 gap-1.5 px-2.5 text-xs font-semibold', className)}
    >
      <Icon aria-hidden="true" data-icon="inline-start" />
      {label}
    </Badge>
  );
}
