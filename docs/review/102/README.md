# Member directory evidence

The original desktop and mobile screenshots were removed on 2026-09-22: the
directory now has a search box, a "Filtrează" Dialog (Group via the searchable
Group picker, role, status) with removable filter chips, a list/card view
switch, a one-line Group cell with a "+N" overflow, and a member profile
Dialog, so the old images no longer matched the page.

The directory's query tests verify protected view reads, the leadership RPC,
missing contact rows, error propagation, paging, and that archived Groups and
the Organization Group are left out of a member's Groups. Component tests
cover diacritic-blind search over names, Groups, roles and email; a member in
seven Groups staying on one line with a "+5" that names the rest and opens the
profile; Group filters that include Child Groups; role and status filters;
removable chips and "Șterge filtrele"; the card view; sorting points
numerically and roles by seniority; loading/error/empty states; and automated
accessibility scans of both views and the filter Dialog. Contact authorization
remains enforced by `profiles_contact`, and the existing `seeDirectory` route
guard restricts navigation.
