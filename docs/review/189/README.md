# Capability read failure and recovery

Captured 2026-09-19 in Chromium against the real `TaskDetailsSheet`, `TaskReviewCapabilityNotice`, and evaluation control. Mobile viewport: 430 × 932; desktop: 1440 × 1000.

- `capability-error-mobile.png` and `capability-error-desktop.png`: the capability RPC returns a fixture HTTP 503; task details remain available with one safe error and retry button.
- `capability-recovered-desktop.png`: clicking retry makes a second capability request, which returns `true`; the error disappears and “Evaluează taskul” becomes available.

Boundary: frontend fixture evidence, not a live authorization or database test. A synthetic member session and cached task details supply the surrounding context; Playwright intercepts REST requests. The capture asserts exactly two capability RPC attempts. No database data was changed. Regression tests additionally exercise the real capability query's error/retry path and both mutation/refetch render orders, including subsequent review cycles.
