-- Authorization is enforced by live Profile checks, JWT level helpers, and
-- scope-specific policies/commands. This lookup was never consulted by them.
-- Omit CASCADE deliberately: an unexpected database dependency must block the
-- migration rather than silently removing an authorization object.
drop table public.role_capabilities;
