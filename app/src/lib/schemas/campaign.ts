import { z } from 'zod';
import { requiredText } from './text';

/**
 * A Campaign, as `create_campaign` / `update_campaign` accept it (#673,
 * ruling R8): a name of 3–120 characters, measured trimmed. A blank name is
 * the commands' own `invalid_campaign_name`.
 */
export const campaignName = requiredText({
  required: 'invalid_campaign_name',
  min: 3,
  tooShort: 'name_too_short',
  max: 120,
  tooLong: 'name_too_long',
});

export const campaignSchema = z.object({ name: campaignName });

/** Where each reason a Campaign command (or this schema) raises is shown. */
export const fieldForReason: Readonly<Record<string, 'name'>> = {
  invalid_campaign_name: 'name',
  name_too_short: 'name',
  name_too_long: 'name',
  campaign_name_taken: 'name',
};
