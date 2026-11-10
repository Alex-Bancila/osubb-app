-- #1206: drop public.evaluation_percents(), the Praguri read nothing calls since R58.
--
-- #866 (ruling R30) wrote it for the Praguri panel of Evaluări de rol. The two
-- shares then lived apart -- x as the top_percent Promotion Rule's percent,
-- y as org_settings.vote_retention_percent -- so the read joined them into
-- one row per kind, with each share's last change from
-- promotion_threshold_changes. R58 (#1081) moved both into the one-row
-- evaluation_settings (activ_percent, vot_percent) and only restated this
-- read over it. Since then Setări reads the settings row directly and the
-- change history straight from promotion_threshold_changes. Nothing calls
-- it any more: no reader in app/src, supabase/functions, scripts or seed.sql.
-- Only pgTAP suites did, and they now read the two tables themselves.
--
-- set_evaluation_percent, evaluation_settings and promotion_threshold_changes
-- are unchanged. No cascade: if anything ever came to depend on the read,
-- this migration fails loudly instead of taking that dependant with it.

drop function public.evaluation_percents();
