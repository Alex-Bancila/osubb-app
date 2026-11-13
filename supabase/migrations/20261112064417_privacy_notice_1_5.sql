-- #1220 (R66, #1217): the Privacy Notice moves to version 1.5.
--
-- docs/legal/politica-de-confidentialitate.md and its app copy
-- (app/src/screens/privacy/PrivacyNoticeContent.tsx) now read "Versiunea 1.5"
-- in the same pull request as this migration. Section 2, Ce date prelucrăm,
-- adds the Adherence Message's confirmation to the Member's activity
-- (public.adherence_message_reads, 20261110223641_adherence_message.sql), and
-- section 4, Cine vede datele tale, says BC and the Moderator see those
-- confirmations. The version moves by migration, in the change that ships the
-- text: the server must never ask for a version the app cannot display.
--
-- Production still asks for 1.3 when this lands, so one Release applies
-- 20261110221753_privacy_notice_1_4.sql and this migration together and every
-- Member is asked once, for 1.5. Wherever 1.4 was already acknowledged
-- (staging), the Member is asked again: acknowledge_privacy_notice('1.4') now
-- answers PT409 privacy_notice_version_stale. The earlier rows stay as the
-- record of what each Member was shown.
--
-- Only a version below 1.5 moves, so a database already at 1.5 or later is
-- left as it is (the comparison is numeric per part: 1.10 is above 1.9). The
-- row's updated_by stays null -- a migration is not a Member -- and the
-- updated_at trigger stamps the change. No function, grant or policy changes.

update public.org_settings
   set value = '1.5',
       updated_by = null
 where key = 'privacy_notice_version'
   and pg_catalog.string_to_array(value, '.')::integer[] < array[1, 5];
