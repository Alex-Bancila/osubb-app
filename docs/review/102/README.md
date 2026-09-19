# Member directory evidence

The desktop (1440 × 1000) and mobile (390 × 844) screenshots render the real
`VolunteersScreen`, shared TanStack/shadcn table, and app theme with deterministic
QueryClient fixtures. Names and contacts are fictional. The fixture includes
positive and negative Task points, an alumnus, Department and Team membership,
and a missing phone number. This is UI evidence, not a live authorization test.

The directory's query tests verify protected view reads, the leadership RPC,
missing contact rows, and error propagation. Component tests cover combined name
and Department filters, Romanian name search, loading/error/empty states, and
an automated accessibility scan. Contact authorization remains enforced by
`profiles_contact`, and the existing `seeDirectory` route guard restricts navigation.
