-- #1140: Postgres 17, the major production runs. Its plpgsql_check (image
-- 17.6.1.x) judges a function's declared volatility against what it calls,
-- and four functions promised more than their bodies keep:
--
--   private.formatted_text_plain        immutable, calls array_to_string (stable)
--   private.require_attached_links      immutable, calls jsonb_build_object and
--                                        jsonb_build_array (stable)
--   private.require_formatted_text_length
--                                        immutable, calls formatted_text_plain,
--                                        which is stable from here on
--   private.require_task_visible        volatile by default, though it only
--                                        reads; private.preview_task_update_impl
--                                        is stable and performs it
--
-- `supabase db lint --level warning --fail-on warning` refused all four on
-- 17. Each is relabelled to what its body is; no body changes. No index,
-- generated column or constraint uses the first three (an index would need
-- immutable), and every caller is a trigger, a command or a stable read, so
-- nothing that calls them moves. The comments and grants stay as they are.

alter function private.formatted_text_plain(text) stable;
alter function private.require_attached_links(jsonb, text, text) stable;
alter function private.require_formatted_text_length(text, text) stable;
alter function private.require_task_visible(bigint) stable;
