-- #860 (ruling (4) of 2026-09-28; Audit D, D-19): the Privacy Notice moves to
-- version 1.1.
--
-- docs/legal/politica-de-confidentialitate.md and its app copy
-- (app/src/screens/privacy/PrivacyNoticeContent.tsx) now read "Versiunea 1.1"
-- in the same pull request as this migration. The version moves by migration,
-- in the change that ships the text: the server must never ask for a version
-- the app cannot display. (The app still copes if it does -- PrivacyGate
-- offers a reload instead of a notice it does not have -- but that is the
-- fallback, not the rule.)
--
-- Bumping the setting re-asks every Member: a Member whose only
-- acknowledgement is 1.0 is shown the Notice again after sign-in, and
-- acknowledge_privacy_notice('1.0') now answers PT409
-- privacy_notice_version_stale. The 1.0 rows stay as the record of what each
-- Member was shown.
--
-- Only a version below 1.1 moves, so a database already at 1.1 or later is
-- left as it is (the comparison is numeric per part: 1.10 is above 1.9). The
-- row's updated_by stays null -- a migration is not a Member -- and the
-- updated_at trigger stamps the change. No function, grant or policy changes.

update public.org_settings
   set value = '1.1'
 where key = 'privacy_notice_version'
   and pg_catalog.string_to_array(value, '.')::integer[] < array[1, 1];
