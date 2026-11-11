import { describeFailure } from '../../lib/command-reasons';
import {
  ANSWER_FAILED,
  useAnswerAdherenceMessage,
  useMyAdherenceMessage,
} from '../../queries/adherence-message';
import { AdherenceMessageDialog } from '../adherence-message/AdherenceMessage';

/**
 * The Adherence Message's pop-up (ruling R66), over every page of the app.
 *
 * An active Voluntar Activ at UBB who has not answered the current version
 * sees BC's message in a dialog over the dimmed, unreachable app, and nothing
 * closes it but **Am citit** (decision 4). It sits inside the shell, so the
 * Privacy Notice is always answered first.
 *
 * Like `PrivacyGate` this is kindness, not security, but unlike it the gate
 * never blocks on an error of its own: while the read fails (or before it
 * answers) nothing is shown, and a failed re-read keeps the last answer.
 * A stale version (BC asked again while it was open) shows the reason and,
 * once the read after every answer lands, the new text.
 */
export function AdherenceMessageGate() {
  const message = useMyAdherenceMessage();
  const answer = useAnswerAdherenceMessage();
  const data = message.data;
  if (!data || data.answered) return null;
  return (
    <AdherenceMessageDialog
      message={data}
      open
      mustAnswer
      answering={answer.isPending}
      error={
        answer.isError
          ? describeFailure(answer.error, ANSWER_FAILED).message
          : undefined
      }
      onAnswer={() => answer.mutate(data.version)}
    />
  );
}
