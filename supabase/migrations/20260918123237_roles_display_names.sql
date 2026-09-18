-- #507: roles.name follows CONTEXT.md — Voluntar Activ and Voluntar cu Drept de Vot (display names only; the member_role enum and the 8-row ladder are untouched).
update public.roles set name = 'Voluntar Activ'           where id = 'activ';
update public.roles set name = 'Voluntar cu Drept de Vot' where id = 'vot';
