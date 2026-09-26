import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError, commandReason } from '../lib/command-reasons';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * The Privacy Notice and Privacy Acknowledgements (#771, ruling L16).
 *
 * The current version is `org_settings.privacy_notice_version`, which every
 * Member reads; BC raises it after a Release that changes the text. A Member
 * who has no acknowledgement row for that version is shown the notice after
 * sign-in until they tap "Am citit și am înțeles". Nothing here is a security
 * control: the gate is kindness, and the server refuses a stale version.
 */

/** The current version, or `null` when the setting does not exist yet. */
async function fetchCurrentVersion(): Promise<string | null> {
  const { data, error } = await supabase
    .from('org_settings')
    .select('value')
    .eq('key', 'privacy_notice_version')
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

export type PrivacyGate = {
  /** The version the Member must acknowledge; `null` = nothing to ask. */
  currentVersion: string | null;
  acknowledged: boolean;
};

export async function fetchPrivacyGate(memberId: string): Promise<PrivacyGate> {
  const currentVersion = await fetchCurrentVersion();
  // No version configured (a database without #771's migration): nothing to
  // acknowledge, so the app opens rather than locking everyone out.
  if (currentVersion === null) return { currentVersion, acknowledged: true };
  const { data, error } = await supabase
    .from('privacy_notice_acknowledgements')
    .select('notice_version')
    .eq('member_id', memberId)
    .eq('notice_version', currentVersion)
    .maybeSingle();
  if (error) throw error;
  return { currentVersion, acknowledged: data !== null };
}

/** Whether the signed-in Member still has to acknowledge the current notice. */
export function usePrivacyGate() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.privacy.gate(memberId),
    queryFn: memberId ? () => fetchPrivacyGate(memberId) : skipToken,
    // A bump by BC must reach a Member who never signs out and never leaves
    // the tab: re-read on every return to the tab and every fifteen minutes
    // while it stays open (one small read; the gate itself never remounts).
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: 15 * 60_000,
  });
}

export const ACKNOWLEDGE_FAILED =
  'Nu am putut salva confirmarea. Verifică internetul și încearcă din nou.';

/**
 * "Am citit și am înțeles". A repeated tap (another tab, a double tap) is
 * `privacy_notice_already_acknowledged`, which is the outcome the Member
 * wanted, so it counts as success. A stale version refreshes the gate, which
 * then asks for the new one.
 */
export function useAcknowledgePrivacyNotice() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (version: string) => {
      const { error } = await supabase.rpc('acknowledge_privacy_notice', {
        p_version: version,
      });
      if (
        error &&
        commandReason(error) !== 'privacy_notice_already_acknowledged'
      )
        throw new CommandError(error, ACKNOWLEDGE_FAILED);
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.privacy.all }),
  });
}

export type PrivacyStatusRow = {
  memberId: string;
  noticeVersion: string | null;
  acknowledgedAt: string | null;
};

export type PrivacyStatus = {
  currentVersion: string | null;
  rows: PrivacyStatusRow[];
};

export async function fetchPrivacyStatus(): Promise<PrivacyStatus> {
  const [currentVersion, status] = await Promise.all([
    fetchCurrentVersion(),
    supabase.rpc('privacy_acknowledgement_status'),
  ]);
  if (status.error) throw status.error;
  return {
    currentVersion,
    rows: (status.data ?? []).map((row) => ({
      memberId: row.member_id,
      noticeVersion: row.notice_version,
      acknowledgedAt: row.acknowledged_at,
    })),
  };
}

/**
 * BC's view (level >= 6): every active Member's latest acknowledgement. Mount
 * it only behind `manageRoles`; anyone else is refused by the server.
 */
export function usePrivacyStatus(enabled = true) {
  const viewerId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.privacy.status(viewerId),
    queryFn: viewerId && enabled ? fetchPrivacyStatus : skipToken,
  });
}

/** Active Members whose latest acknowledgement is not the current version. */
export function missingAcknowledgements(status: PrivacyStatus) {
  return status.rows.filter(
    (row) => row.noticeVersion !== status.currentVersion,
  );
}

/** `26 septembrie 2026`, the day an acknowledgement was made, in Romania. */
export function formatAcknowledgedAt(instant: string): string {
  return new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Bucharest',
  }).format(new Date(instant));
}

/** The member page's line: "v1.0 · 26 septembrie 2026" or "neconfirmată". */
export function acknowledgementLabel(row: PrivacyStatusRow | null | undefined) {
  return row?.noticeVersion && row.acknowledgedAt
    ? `v${row.noticeVersion} · ${formatAcknowledgedAt(row.acknowledgedAt)}`
    : 'neconfirmată';
}

/**
 * One Member's latest acknowledgement, for their page in Administrare. Read
 * straight from the table (BC and the Moderator read every row), so a
 * deactivated Member's record shows too — the status list holds only active
 * Members. `null` = never acknowledged.
 */
export async function fetchMemberAcknowledgement(
  memberId: string,
): Promise<PrivacyStatusRow | null> {
  const { data, error } = await supabase
    .from('privacy_notice_acknowledgements')
    .select('notice_version, acknowledged_at')
    .eq('member_id', memberId)
    .order('acknowledged_at', { ascending: false })
    // Same tie-break as privacy_acknowledgement_status().
    .order('notice_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        memberId,
        noticeVersion: data.notice_version,
        acknowledgedAt: data.acknowledged_at,
      }
    : null;
}

export function useMemberAcknowledgement(
  memberId: string | undefined,
  enabled: boolean,
) {
  const viewerId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.privacy.member(memberId ?? '', viewerId),
    queryFn:
      viewerId && memberId && enabled
        ? () => fetchMemberAcknowledgement(memberId)
        : skipToken,
  });
}
