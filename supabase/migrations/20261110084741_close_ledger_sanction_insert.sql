-- #1182 (audit L4, decision 6 of #1144): no client role inserts into the
-- ledger until #104 builds a Sanction command.
--
-- The policy points_ledger_create_sanction and the table-wide INSERT grant to
-- authenticated let a live BC member insert a `sanction` row with any
-- created_at, member_id and delta, notifying nobody; Clasament and Portofoliu
-- Interne then count it. Nothing in the app writes the ledger directly, and
-- Sanctions are deferred to after launch (#104), whose command will be the
-- Sanction write path.
--
-- Every writer (private.evaluate_task and the other commands) is security
-- definer and runs as the owner, so none of them moves; the ledger suite pins
-- that. The id sequence's USAGE and SELECT went to authenticated for the
-- direct insert alone, so they go with it. SELECT on the table, its read
-- policies and every command stay as they are.

drop policy points_ledger_create_sanction on public.points_ledger;

revoke insert on table public.points_ledger from authenticated;

revoke usage, select on sequence public.points_ledger_id_seq from authenticated;
