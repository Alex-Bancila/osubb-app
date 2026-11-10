-- #1183: the Privacy Notice moves to version 1.4.
--
-- docs/legal/politica-de-confidentialitate.md and its app copy
-- (app/src/screens/privacy/PrivacyNoticeContent.tsx) now read "Versiunea 1.4"
-- in the same pull request as this migration (audit L40 and M9, decisions 5
-- and 7 of #1144). Section 6, Cât păstrăm datele, now names two periods it
-- left open: read Notifications are deleted 90 days after they reached their
-- Member, unread ones are kept (#1151's daily purge), and Supabase's sign-in
-- logs are kept 7 days, also after an account is deleted. Section 3 names who
-- else is told of a Retention Signal: the Adunarea Generală's Group
-- Responsibles at BCE level (R58 follow-up). The version moves by migration,
-- in the change that ships the text: the server must never ask for a version
-- the app cannot display.
--
-- Bumping the setting re-asks every Member: a Member whose latest
-- acknowledgement is 1.3 is shown the Notice again after sign-in, and
-- acknowledge_privacy_notice('1.3') now answers PT409
-- privacy_notice_version_stale. The earlier rows stay as the record of what
-- each Member was shown.
--
-- Only a version below 1.4 moves, so a database already at 1.4 or later is
-- left as it is (the comparison is numeric per part: 1.10 is above 1.9). The
-- row's updated_by stays null -- a migration is not a Member -- and the
-- updated_at trigger stamps the change. No function, grant or policy changes.

update public.org_settings
   set value = '1.4',
       updated_by = null
 where key = 'privacy_notice_version'
   and pg_catalog.string_to_array(value, '.')::integer[] < array[1, 4];
