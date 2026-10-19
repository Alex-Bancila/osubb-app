-- #1081: the Privacy Notice moves to version 1.3 (R58, part 3).
--
-- docs/legal/politica-de-confidentialitate.md and its app copy
-- (app/src/screens/privacy/PrivacyNoticeContent.tsx) now read "Versiunea 1.3"
-- in the same pull request as this migration. Section 3, Decizii automate,
-- described one rule that applied itself -- Recrut to Voluntar after the
-- required tenure -- and a tenure gate on the Voluntar Activ list. Portofoliu
-- Interne dropped both (20261018170000_portofoliu_interne.sql: the Promotion
-- Rules and the daily job are gone), so the section no longer describes
-- anything that exists. It now says nothing changes a Role automatically, and
-- that a Role Evaluation, a live Promotion Candidate and a change of the
-- recorded Universitate only put a Member on a list for BC, who decides by
-- hand; the Member is told of none of them. The version moves by migration, in
-- the change that ships the text: the server must never ask for a version the
-- app cannot display. (The app still copes if it does -- PrivacyGate offers a
-- reload instead of a notice it does not have -- but that is the fallback, not
-- the rule.)
--
-- Bumping the setting re-asks every Member: a Member whose latest
-- acknowledgement is 1.2 is shown the Notice again after sign-in, and
-- acknowledge_privacy_notice('1.2') now answers PT409
-- privacy_notice_version_stale. The 1.0, 1.1 and 1.2 rows stay as the record of
-- what each Member was shown.
--
-- Only a version below 1.3 moves, so a database already at 1.3 or later is
-- left as it is (the comparison is numeric per part: 1.10 is above 1.9). The
-- row's updated_by stays null -- a migration is not a Member -- and the
-- updated_at trigger stamps the change. No function, grant or policy changes.

update public.org_settings
   set value = '1.3',
       updated_by = null
 where key = 'privacy_notice_version'
   and pg_catalog.string_to_array(value, '.')::integer[] < array[1, 3];
