import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: api.invoke } },
}));

import { requestInvitation } from './request-invitation';

/** A non-2xx answer as supabase-js hands it over: the Response inside. */
function refused(status: number, body: string) {
  return {
    data: null,
    error: Object.assign(new Error('Edge Function returned a non-2xx'), {
      context: new Response(body, {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    }),
  };
}

describe('requestInvitation (#968)', () => {
  beforeEach(() => api.invoke.mockReset());

  it('asks the request-invitation function for the address and reads 202 as sent', async () => {
    api.invoke.mockResolvedValue({ data: { ok: true }, error: null });

    await expect(requestInvitation('membru@exemplu.ro')).resolves.toBe('sent');
    expect(api.invoke).toHaveBeenCalledWith('request-invitation', {
      body: { email: 'membru@exemplu.ro' },
    });
  });

  it('reads a 429 as rate_limited', async () => {
    api.invoke.mockResolvedValue(
      refused(429, JSON.stringify({ code: 'rate_limited', error: 'x' })),
    );

    await expect(requestInvitation('membru@exemplu.ro')).resolves.toBe(
      'rate_limited',
    );
  });

  it('reads any other refusal, a gateway error or a throw as failed — never as sent', async () => {
    api.invoke.mockResolvedValueOnce(
      refused(500, JSON.stringify({ code: 'unexpected_error', error: 'x' })),
    );
    api.invoke.mockResolvedValueOnce(refused(502, 'Bad Gateway'));
    api.invoke.mockResolvedValueOnce({
      data: null,
      error: new Error('Failed to send a request to the Edge Function'),
    });
    api.invoke.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    for (let call = 0; call < 4; call += 1) {
      await expect(requestInvitation('membru@exemplu.ro')).resolves.toBe(
        'failed',
      );
    }
  });
});
