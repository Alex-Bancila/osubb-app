import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  invoke: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: { invoke: api.invoke },
    rpc: api.rpc,
    from: api.from,
  },
}));
import {
  applyVolunteerImport,
  fetchUninvitedMembers,
  IMPORT_CHUNK,
  isVolunteerSheet,
  previewVolunteerImport,
  readSendResult,
  sendInvitationBatch,
  updateUninvitedContact,
} from './volunteer-import';

// Fake people only: the real sheet never enters a test.
const HEADER =
  'Nume & Prenume,Funcția,Email,Număr de telefon,Departament PRINCIPAL,Departament secundar,Departament secundar,Departament secundar,Departament secundar,Data Nașterii,Universitatea,Facultatea,Specializarea,Nivel,An de studiu';

beforeEach(() => {
  api.invoke.mockReset();
  api.rpc.mockReset();
  api.from.mockReset();
});

describe('isVolunteerSheet', () => {
  it('tells the volunteer sheet from the name,email,dept,team file', () => {
    expect(isVolunteerSheet(`${HEADER}\nPop Ana,Membru voluntar`)).toBe(true);
    expect(isVolunteerSheet(`﻿${HEADER}`)).toBe(true);
    expect(isVolunteerSheet('name,email,dept,team\nAna,a@x.ro,EDU,')).toBe(
      false,
    );
  });
});

describe('previewVolunteerImport', () => {
  it('asks for a dry run and reads rows, placements, problems and counts', async () => {
    api.invoke.mockResolvedValue({
      error: null,
      data: {
        format: 'volunteers',
        mode: 'dry_run',
        rows: [
          {
            row: 2,
            full_name: 'Pop Ana',
            email: 'ana@example.test',
            rank: 'vot',
            action: 'create',
            placements: [
              {
                group_id: 7,
                group_name: 'Educațional',
                group_role: 'member',
                position_title: null,
              },
            ],
            problems: [],
          },
          {
            row: 3,
            full_name: 'Ionescu Dan',
            email: 'dan@example.test',
            rank: 'voluntar',
            action: 'create',
            placements: [],
            problems: [
              {
                code: 'project_missing',
                message: 'proiect lipsă: Gala',
                blocking: false,
              },
            ],
          },
          {
            row: 4,
            full_name: 'Fără Adresă',
            email: '',
            rank: 'voluntar',
            action: 'skip',
            placements: [],
            problems: [
              {
                code: 'email_missing',
                message: 'Lipsește adresa.',
                blocking: true,
              },
            ],
          },
        ],
      },
    });
    const preview = await previewVolunteerImport('csv');
    expect(api.invoke).toHaveBeenCalledWith('csv-import', {
      body: { csv: 'csv', mode: 'dry_run' },
    });
    expect(preview).toMatchObject({ ok: 1, withProblems: 2, importable: 2 });
    expect(preview.rows[0]).toEqual({
      row: 2,
      name: 'Pop Ana',
      email: 'ana@example.test',
      rank: 'vot',
      action: 'create',
      placements: [
        {
          groupId: 7,
          groupName: 'Educațional',
          groupRole: 'member',
          positionTitle: null,
        },
      ],
      problems: [],
    });
    expect(preview.rows[1]?.problems[0]?.blocking).toBe(false);
    expect(preview.rows[2]?.problems[0]?.blocking).toBe(true);
  });

  it("passes the function's own refusal through", async () => {
    api.invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(
          JSON.stringify({
            code: 'too_many_rows',
            error: 'Prea multe rânduri.',
          }),
          { status: 413 },
        ),
      },
    });
    await expect(previewVolunteerImport('csv')).rejects.toThrow(
      'Prea multe rânduri.',
    );
  });
});

describe('applyVolunteerImport', () => {
  it('names the rows in chunks, reports progress and adds up every outcome', async () => {
    const rows = Array.from({ length: IMPORT_CHUNK + 3 }, (_, i) => i + 2);
    api.invoke.mockImplementation(
      (_name: string, { body }: { body: { rows: number[] } }) =>
        Promise.resolve({
          error: null,
          data: {
            rows: body.rows.map((row) => ({
              row,
              email: `v${row}@example.test`,
              outcome:
                row === 3 ? 'completed' : row === 4 ? 'failed' : 'created',
              message: row === 4 ? 'Telefon invalid.' : undefined,
            })),
          },
        }),
    );
    const progress: Array<[number, number]> = [];
    const result = await applyVolunteerImport('csv', rows, (done, total) =>
      progress.push([done, total]),
    );
    expect(api.invoke).toHaveBeenCalledTimes(2);
    expect(api.invoke.mock.calls[0]?.[1]).toEqual({
      body: { csv: 'csv', mode: 'apply', rows: rows.slice(0, IMPORT_CHUNK) },
    });
    expect(api.invoke.mock.calls[1]?.[1].body.rows).toEqual(
      rows.slice(IMPORT_CHUNK),
    );
    expect(progress).toEqual([
      [0, rows.length],
      [IMPORT_CHUNK, rows.length],
      [rows.length, rows.length],
    ]);
    expect(result).toMatchObject({
      created: rows.length - 2,
      completed: 1,
      failed: 1,
      skipped: 0,
    });
    expect(result.rows.find((row) => row.row === 4)?.message).toBe(
      'Telefon invalid.',
    );
  });

  it('marks a refused chunk as failed and still sends the next one', async () => {
    const rows = Array.from({ length: IMPORT_CHUNK + 1 }, (_, i) => i + 2);
    api.invoke
      .mockResolvedValueOnce({ data: null, error: new Error('network') })
      .mockResolvedValueOnce({
        error: null,
        data: { rows: [{ row: rows.at(-1), email: 'x', outcome: 'created' }] },
      });
    const result = await applyVolunteerImport('csv', rows);
    expect(result.failed).toBe(IMPORT_CHUNK);
    expect(result.created).toBe(1);
    expect(result.rows[0]?.message).toMatch(/Importă din nou fișierul/);
  });
});

describe('sending', () => {
  it('sends one batch by id and reads each status', async () => {
    api.invoke.mockResolvedValue({
      error: null,
      data: {
        results: [
          {
            member_id: 'a',
            status: 'sent',
            invited_at: '2026-10-02T10:00:00Z',
          },
          { member_id: 'b', status: 'failed', message: 'Refuzat.' },
        ],
      },
    });
    const result = await sendInvitationBatch(['a', 'b']);
    expect(api.invoke).toHaveBeenCalledWith('send-invitations', {
      body: { member_ids: ['a', 'b'] },
    });
    expect(result).toEqual({
      rateLimited: false,
      results: [
        {
          memberId: 'a',
          status: 'sent',
          invitedAt: '2026-10-02T10:00:00Z',
          message: null,
        },
        {
          memberId: 'b',
          status: 'failed',
          invitedAt: null,
          message: 'Refuzat.',
        },
      ],
    });
  });

  it('reads a rate-limit stop from the flag or from a row', () => {
    expect(
      readSendResult({
        results: [],
        stopped: { reason: 'rate_limited', member_id: 'a' },
      }).rateLimited,
    ).toBe(true);
    expect(
      readSendResult({ results: [{ member_id: 'a', status: 'rate_limited' }] })
        .rateLimited,
    ).toBe(true);
    expect(
      readSendResult({
        results: [],
        stopped: { reason: 'time_budget', member_id: 'a' },
      }).rateLimited,
    ).toBe(false);
    // An unknown status is never read as sent.
    expect(
      readSendResult({ results: [{ member_id: 'a', status: 'ok' }] }).results[0]
        ?.status,
    ).toBe('failed');
  });
});

describe('the grid', () => {
  it('reads uninvited_members(): roster order, notes never blocking', async () => {
    api.rpc.mockResolvedValue({
      error: null,
      data: [
        {
          member_id: 'm1',
          full_name: 'Pop Ana',
          email: 'ana@example.test',
          phone: null,
          role: 'bce',
          problems: ['BCE fără poziție'],
          memberships: [
            {
              group_id: 3,
              name: 'Educațional',
              group_role: 'manager',
              position_title: null,
            },
            { group_id: 5, name: 'Tineret', group_role: 'member' },
          ],
        },
      ],
    });
    const [member] = await fetchUninvitedMembers();
    expect(api.rpc).toHaveBeenCalledWith('uninvited_members');
    expect(member).toEqual({
      memberId: 'm1',
      name: 'Pop Ana',
      email: 'ana@example.test',
      phone: null,
      role: 'bce',
      groups: [
        {
          groupId: 3,
          groupName: 'Educațional',
          groupRole: 'manager',
          positionTitle: null,
        },
        {
          groupId: 5,
          groupName: 'Tineret',
          groupRole: 'member',
          positionTitle: null,
        },
      ],
      problems: [
        { code: 'note', message: 'BCE fără poziție', blocking: false },
      ],
    });
  });

  it.each([
    ['fullName', 'full_name', 'Pop Ana'],
    ['email', 'email', 'ana@example.test'],
    ['phone', 'phone', '+40712345678'],
  ] as const)(
    'writes %s to profiles.%s and requires the row back',
    async (field, column, value) => {
      const single = vi.fn().mockResolvedValue({ error: null });
      const select = vi.fn(() => ({ single }));
      const eq = vi.fn(() => ({ select }));
      const update = vi.fn(() => ({ eq }));
      api.from.mockReturnValue({ update });
      await updateUninvitedContact({ memberId: 'm1', field, value });
      expect(api.from).toHaveBeenCalledWith('profiles');
      expect(update).toHaveBeenCalledWith({ [column]: value });
      expect(eq).toHaveBeenCalledWith('id', 'm1');
      expect(single).toHaveBeenCalled();
    },
  );
});
