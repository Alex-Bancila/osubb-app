-- Ruling R58: the Privacy Notice moves to version 1.2.
--
-- docs/legal/politica-de-confidentialitate.md and its app copy
-- (app/src/screens/privacy/PrivacyNoticeContent.tsx) now read "Versiunea 1.2"
-- in the same pull request as this migration: the notice names the Universitate
-- (the university a Member studies at, profiles.university) among what the
-- organization records, and says every Member sees it on the Member Card and in
-- the directory. The version moves by migration, in the change that ships the
-- text: the server must never ask for a version the app cannot display. (The
-- app still copes if it does -- PrivacyGate offers a reload instead of a notice
-- it does not have -- but that is the fallback, not the rule.)
--
-- Bumping the setting re-asks every Member: a Member whose latest
-- acknowledgement is 1.1 is shown the Notice again after sign-in, and
-- acknowledge_privacy_notice('1.1') now answers PT409
-- privacy_notice_version_stale. The 1.0 and 1.1 rows stay as the record of what
-- each Member was shown.
--
-- Only a version below 1.2 moves, so a database already at 1.2 or later is
-- left as it is (the comparison is numeric per part: 1.10 is above 1.9). The
-- row's updated_by stays null -- a migration is not a Member -- and the
-- updated_at trigger stamps the change. No function, grant or policy changes.

update public.org_settings
   set value = '1.2',
       updated_by = null
 where key = 'privacy_notice_version'
   and pg_catalog.string_to_array(value, '.')::integer[] < array[1, 2];
