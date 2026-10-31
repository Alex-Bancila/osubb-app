import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postgrest } from '../test/postgrest-fake';

vi.mock('../lib/supabase', async () => ({
  supabase: (await import('../test/postgrest-fake')).postgrest.client,
}));

import { fetchPrivacyStatus, missingAcknowledgements } from './privacy';

/*
 * #1136: `privacy_acknowledgement_status` returns one row per active Member,
 * and PostgREST answers at most 500 rows a request (the fake does the same),
 * so BC's list must be read by pages: 600 Members are two requests of 500
 * and 100, concatenated, in one stable order.
 */

const MEMBERS = 600;

beforeEach(() => postgrest.reset());

describe('fetchPrivacyStatus', () => {
  it('reads every active Member past 500 by pages', async () => {
    postgrest.serve('org_settings', [{ value: '1.3' }]);
    postgrest.serve(
      'privacy_acknowledgement_status',
      Array.from({ length: MEMBERS }, (_, index) => ({
        member_id: `member-${String(index).padStart(3, '0')}`,
        notice_version: index % 2 === 0 ? '1.3' : null,
        acknowledged_at: index % 2 === 0 ? '2026-10-01T10:00:00Z' : null,
      })),
    );

    const status = await fetchPrivacyStatus();

    expect(status.currentVersion).toBe('1.3');
    expect(status.rows).toHaveLength(MEMBERS);
    expect(status.rows.at(-1)).toEqual({
      memberId: 'member-599',
      noticeVersion: null,
      acknowledgedAt: null,
    });
    expect(missingAcknowledgements(status)).toHaveLength(MEMBERS / 2);

    const requests = postgrest.requestsTo('privacy_acknowledgement_status');
    expect(requests).toHaveLength(2);
    expect(
      requests.map((request) => postgrest.argsOf(request, 'range')),
    ).toEqual([[[0, 499]], [[500, 999]]]);
    // Ordered on the unique column, so no row is skipped or repeated.
    for (const request of requests)
      expect(postgrest.argsOf(request, 'order')).toEqual([['member_id']]);
  });

  it('fails the whole read when a page fails', async () => {
    postgrest.serve('org_settings', [{ value: '1.3' }]);
    postgrest.serve(
      'privacy_acknowledgement_status',
      new Error('permission denied'),
    );
    await expect(fetchPrivacyStatus()).rejects.toThrow('permission denied');
  });
});
