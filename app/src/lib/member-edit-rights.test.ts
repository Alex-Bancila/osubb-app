import { describe, expect, it } from 'vitest';
import { memberEditRights, NO_MEMBER_EDITS } from './member-edit-rights';

const viewer = 'a0000000-0000-4000-8000-000000000006';
const other = 'b0000000-0000-4000-8000-000000000009';

describe('memberEditRights (#944, ruling R31)', () => {
  it('lets a live BC or Moderator edit any other Member, leadership included', () => {
    // The target's rank is not an input: a BC's or the Moderator's page
    // offers the same edits as a Voluntar's.
    expect(memberEditRights({ id: viewer, leads: true }, other)).toEqual({
      profile: true,
      rankAndStatus: true,
    });
  });

  it('lets them edit their own Profile but never their own rank or Status', () => {
    expect(memberEditRights({ id: viewer, leads: true }, viewer)).toEqual({
      profile: true,
      rankAndStatus: false,
    });
  });

  it('offers nothing below BC, on anyone', () => {
    expect(memberEditRights({ id: viewer, leads: false }, other)).toEqual(
      NO_MEMBER_EDITS,
    );
    expect(memberEditRights({ id: viewer, leads: false }, viewer)).toEqual(
      NO_MEMBER_EDITS,
    );
  });

  it('offers nothing without a session or a Member', () => {
    expect(memberEditRights({ id: undefined, leads: true }, other)).toEqual(
      NO_MEMBER_EDITS,
    );
    expect(memberEditRights({ id: viewer, leads: true }, undefined)).toEqual(
      NO_MEMBER_EDITS,
    );
  });
});
