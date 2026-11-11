import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { CommandError } from '../lib/command-reasons';
import { supabase } from '../lib/supabase';
import { keys } from './keys';

/**
 * The Adherence Message (ruling R66): one message BC writes on Portofoliu
 * Interne for every active Voluntar Activ at UBB, answered with "Am citit".
 *
 * A Member never reads the table: `my_adherence_message()` returns one row to
 * an eligible Member while a message exists, and nothing to anyone else. The
 * pop-up shows while `answered` is false; Profil shows the message once it is
 * true. Nothing here is a security control: every command decides again.
 */
export type MyAdherenceMessage = {
  title: string;
  /** Formatted Text (R60). */
  body: string;
  /** Both or neither: a message may carry no link. */
  linkUrl: string | null;
  linkLabel: string | null;
  version: number;
  answered: boolean;
};

export async function fetchMyAdherenceMessage(): Promise<MyAdherenceMessage | null> {
  const { data, error } = await supabase.rpc('my_adherence_message');
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    title: row.title,
    body: row.body,
    // The generated types call every returned column non-null; the link's two
    // halves are null for a message without one.
    linkUrl: (row.link_url as string | null) ?? null,
    linkLabel: (row.link_label as string | null) ?? null,
    version: row.version,
    answered: row.answered,
  };
}

/** The signed-in Member's message: `null` when there is none for them. */
export function useMyAdherenceMessage() {
  const memberId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.adherence.mine(memberId),
    queryFn: memberId ? fetchMyAdherenceMessage : skipToken,
    // A save reaches an open app through live changes (ADR-0011); a return to
    // the tab reads it again in case a signal was missed while it slept.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: 'always',
  });
}

export const ANSWER_FAILED =
  'Nu am putut salva confirmarea. Verifică internetul și încearcă din nou.';

/**
 * "Am citit": records the version on screen. A stale version is
 * `adherence_message_changed` (BC asked again while the pop-up was open);
 * the read that follows every answer then shows the new text.
 */
export function useAnswerAdherenceMessage() {
  const client = useQueryClient();
  const memberId = useAuth().session?.user.id;
  return useMutation({
    mutationFn: async (version: number) => {
      const { error } = await supabase.rpc('answer_adherence_message', {
        p_version: version,
      });
      if (error) throw new CommandError(error, ANSWER_FAILED);
    },
    // Close the pop-up at once; the read below confirms it.
    onSuccess: (_, version) =>
      client.setQueryData<MyAdherenceMessage | null>(
        keys.adherence.mine(memberId),
        (current) =>
          current && current.version === version
            ? { ...current, answered: true }
            : current,
      ),
    onSettled: () => client.invalidateQueries({ queryKey: keys.adherence.all }),
  });
}

/** The message as BC keeps it: every column, a message or not. */
export type AdherenceMessage = {
  /** `null` with `body` while there is no message (turned off, or never written). */
  title: string | null;
  body: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
};

export async function fetchAdherenceMessage(): Promise<AdherenceMessage> {
  const { data, error } = await supabase
    .from('adherence_message')
    .select(
      'title, body, link_url, link_label, version, updated_at, updated_by',
    )
    .eq('id', 1)
    .single();
  if (error) throw error;
  return {
    title: data.title,
    body: data.body,
    linkUrl: data.link_url,
    linkLabel: data.link_label,
    version: data.version,
    updatedAt: data.updated_at,
    updatedBy: data.updated_by,
  };
}

/** BC's read of the row (level 6 on the server); mount behind `manageRoles`. */
export function useAdherenceMessage(enabled = true) {
  const viewerId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.adherence.message(viewerId),
    queryFn: viewerId && enabled ? fetchAdherenceMessage : skipToken,
  });
}

/** How many eligible Members there are, and how many answered this version. */
export type AdherenceMessageStatus = { eligible: number; answered: number };

export async function fetchAdherenceMessageStatus(): Promise<AdherenceMessageStatus> {
  const { data, error } = await supabase.rpc('adherence_message_status');
  if (error) throw error;
  const row = data?.[0];
  return {
    eligible: row?.eligible_count ?? 0,
    answered: row?.answered_count ?? 0,
  };
}

export function useAdherenceMessageStatus(enabled = true) {
  const viewerId = useAuth().session?.user.id;
  return useQuery({
    queryKey: keys.adherence.status(viewerId),
    queryFn: viewerId && enabled ? fetchAdherenceMessageStatus : skipToken,
  });
}

/**
 * What the Mesaj view saves. `null` title and body turn the message off; the
 * link is stored as sent either way. `askAgain` gives every eligible Member
 * the pop-up again (a first message always does).
 */
export type AdherenceMessageChange = {
  title: string | null;
  body: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  askAgain: boolean;
};

export const SAVE_MESSAGE_FAILED = 'Nu am putut salva mesajul. Reîncearcă.';

export async function runAdherenceMessageChange(
  change: AdherenceMessageChange,
): Promise<void> {
  const { error } = await supabase.rpc('set_adherence_message', {
    // The server trims every text and stores a blank one as null.
    p_title: change.title ?? '',
    p_body: change.body ?? '',
    p_link_url: change.linkUrl ?? '',
    p_link_label: change.linkLabel ?? '',
    p_ask_again: change.askAgain,
  });
  if (error) throw new CommandError(error, SAVE_MESSAGE_FAILED);
}

/**
 * `set_adherence_message` (level 6 on the server). Refreshes the row, the
 * counts and BC's own pop-up — after a refusal too, since a stale page is
 * what most refusals report.
 */
export function useAdherenceMessageChange() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runAdherenceMessageChange,
    onSettled: () => client.invalidateQueries({ queryKey: keys.adherence.all }),
  });
}
