# ADR-0002 — Capacitor + React + Ionic for the cross-platform client

- **Status:** Accepted (2026-07-07) — frontend decision, recorded here because it shapes the app but does not affect the backend.
- **Deciders:** Alex Băncilă + team
- **Context docs:** `docs/osubb-app-tech-stack.md` §9.1 / §10.1

## Context

The app must run on Android, iPhone, and desktop (Windows/Mac **browsers**). Its heaviest surface is a permission-dense **admin dashboard** (tables, sheets, leaderboards, CSV import) used mostly on desktop by coordinators; the phone surface is lighter (tasks, calendar, feed, notifications). Judged on technical merit (mockup-reuse and learning curve set aside), the deciding factor is which stack best delivers a dense, accessible, browser-delivered dashboard while still shipping real phone apps.

## Decision

Build **one web app** with **Vite + React + Ionic** plus a real data grid (**AG Grid Community**, MIT), and wrap the same bundle with **Capacitor** for native iOS/Android. The browser build *is* the desktop deliverable.

## Consequences

- **+** Real DOM/CSS + a mature grid make the desktop dashboard first-class; single codebase covers desktop browser + phones.
- **+** Backend-agnostic — this choice does not affect the Supabase backend, which is the current focus.
- **−** WebView gives a slightly less "native" mobile feel (fine for this app's light phone surface); no managed cloud build (use **Codemagic** for no-Mac iOS builds).
- **Alternative:** **Flutter** is a close co-leader — revisit if the desktop should ship as a *free native* app or the phone experience must become truly native. **Expo/React Native** was rejected: React Native Web would force a second web codebase for the dashboard.
