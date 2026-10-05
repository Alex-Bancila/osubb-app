// Tests for the Email Digest's text. Run with `deno test supabase/functions/`.

import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  type DigestItem,
  escapeHtml,
  EXCERPT_CHARS,
  renderDigest,
  unreadPhrase,
} from "./render.ts";

const ORIGIN = "https://app.osubb.ro";

function item(overrides: Partial<DigestItem> = {}): DigestItem {
  return {
    id: 1,
    title: "Task nou",
    body: "Ai primit „Afiș”.",
    link: "/tracker/12",
    // 14:05 in Bucharest (summer time, UTC+3).
    created_at: "2026-09-27T11:05:00Z",
    ...overrides,
  };
}

Deno.test("unreadPhrase follows Romanian number agreement", () => {
  assertEquals(unreadPhrase(1), "o notificare necitită");
  assertEquals(unreadPhrase(2), "2 notificări necitite");
  assertEquals(unreadPhrase(19), "19 notificări necitite");
  assertEquals(unreadPhrase(20), "20 de notificări necitite");
  assertEquals(unreadPhrase(101), "101 notificări necitite");
  assertEquals(unreadPhrase(120), "120 de notificări necitite");
});

Deno.test("the subject counts the unread Notifications", () => {
  const one = renderDigest({
    name: "Ana",
    unreadCount: 1,
    items: [item()],
    origin: ORIGIN,
  });
  assertEquals(one.subject, "Ai o notificare necitită");
  const three = renderDigest({
    name: "Ana",
    unreadCount: 3,
    items: [item(), item({ id: 2 }), item({ id: 3 })],
    origin: ORIGIN,
  });
  assertEquals(three.subject, "Ai 3 notificări necitite");
});

Deno.test("each Notification gets one line and an absolute link into the app", () => {
  const { text, html } = renderDigest({
    name: "Ana",
    unreadCount: 2,
    items: [item(), item({ id: 2, title: "Fără link", link: null })],
    origin: ORIGIN,
  });
  assert(text.startsWith("Salut, Ana!\n"));
  // The time is Bucharest's, not UTC's.
  assert(text.includes("- Task nou (27 sept., 14:05)"));
  // #1012: each line carries its Notification's id, so following it reads it.
  assert(text.includes("  https://app.osubb.ro/tracker/12?notificare=1\n"));
  // No usable link opens the notification list.
  assert(text.includes("  https://app.osubb.ro/notificari?notificare=2\n"));
  assert(html.includes('href="https://app.osubb.ro/tracker/12?notificare=1"'));
  assert(text.includes("Toate notificările: https://app.osubb.ro/notificari"));
});

Deno.test("the opt-out line points at the Profil switch", () => {
  const { text, html } = renderDigest({
    name: "Ana",
    unreadCount: 1,
    items: [item()],
    origin: ORIGIN,
  });
  assert(text.includes("„Rezumat zilnic pe email”"));
  assert(text.includes("https://app.osubb.ro/profil#rezumat-email"));
  assert(html.includes('href="https://app.osubb.ro/profil#rezumat-email"'));
});

Deno.test("user text is escaped in the HTML", () => {
  const { html } = renderDigest({
    name: `<img src=x onerror="alert(1)">`,
    unreadCount: 1,
    items: [item({
      title: `<script>alert("t")</script>`,
      body: `Vezi <a href="https://evil.example">aici</a> & 'altceva'`,
    })],
    origin: ORIGIN,
  });
  assertFalse(html.includes("<script>"));
  assertFalse(html.includes("<img"));
  assertFalse(html.includes('<a href="https://evil.example">'));
  assert(html.includes("&lt;script&gt;alert(&quot;t&quot;)&lt;/script&gt;"));
  assert(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert(html.includes("&amp; &#39;altceva&#39;"));
});

Deno.test("a link that would leave the app opens the notification list", () => {
  const { text, html } = renderDigest({
    name: "Ana",
    unreadCount: 3,
    items: [
      item({ link: "https://evil.example/phish" }),
      item({ id: 2, link: "//evil.example" }),
      item({ id: 3, link: `/tracker/1" onclick="x` }),
    ],
    origin: ORIGIN,
  });
  assertFalse(text.includes("evil.example"));
  assertFalse(html.includes("evil.example"));
  assertFalse(html.includes('" onclick="'));
});

Deno.test("text lines stay one line and long bodies are cut", () => {
  const { text } = renderDigest({
    name: "Ana\r\nBcc: x@y.z",
    unreadCount: 1,
    items: [item({ title: "Titlu\ncu rând nou", body: "a".repeat(500) })],
    origin: ORIGIN,
  });
  assert(text.startsWith("Salut, Ana Bcc: x@y.z!\n"));
  assert(text.includes("- Titlu cu rând nou"));
  assert(text.includes(`  ${"a".repeat(EXCERPT_CHARS)}…\n`));
  assertFalse(text.includes("a".repeat(EXCERPT_CHARS + 1)));
});

Deno.test("more unread than listed says how many more", () => {
  const { text, html } = renderDigest({
    name: "Ana",
    unreadCount: 25,
    items: Array.from({ length: 20 }, (_, index) => item({ id: index + 1 })),
    origin: ORIGIN,
  });
  assert(text.includes("Ai 25 de notificări necitite"));
  assert(text.includes("Și încă 5 în aplicație."));
  assert(html.includes("Și încă 5 în aplicație."));
});

Deno.test("escapeHtml covers the five characters", () => {
  assertEquals(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});
