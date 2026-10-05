// The Email Digest's text -- #775. Pure: a claimed digest in, a subject and
// the plain-text and HTML bodies out. Everything a Member or an author wrote
// (a Notification's title and body, the Member's Nickname) is escaped before
// it reaches the HTML, and flattened to one line in the text body.

import { NOTIFICATIONS_PATH, notificationUrl } from "../_shared/app-links.ts";

/** One Notification as public.claim_email_digests lists it. */
export interface DigestItem {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
}

export interface DigestInput {
  /** The Member's Nickname, or their full name when unset. */
  name: string;
  /** How many of the digest's Notifications are still unread. */
  unreadCount: number;
  /** The latest of them (at most 20), newest first. */
  items: DigestItem[];
  /** The app's https origin (first ALLOWED_ORIGINS entry). */
  origin: string;
}

export interface RenderedDigest {
  subject: string;
  text: string;
  html: string;
}

/** Where the digest's opt-out line points: the Profil switch itself. */
export const OPT_OUT_PATH = "/profil#rezumat-email";

/** How much of a Notification's body the digest shows. */
export const EXCERPT_CHARS = 160;

const ELLIPSIS = "…";

const WHEN = new Intl.DateTimeFormat("ro-RO", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Bucharest",
});

/** Text safe inside HTML element content and double- or single-quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One line: every run of whitespace or control characters becomes a space. */
function oneLine(value: string): string {
  // deno-lint-ignore no-control-regex
  return value.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();
}

function excerpt(body: string | null): string | null {
  if (body === null) return null;
  const flat = oneLine(body);
  if (flat === "") return null;
  const chars = Array.from(flat);
  if (chars.length <= EXCERPT_CHARS) return flat;
  return chars.slice(0, EXCERPT_CHARS).join("").trimEnd() + ELLIPSIS;
}

function when(createdAt: string): string | null {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? null : WHEN.format(date);
}

/**
 * "o notificare necitită", "3 notificări necitite", "20 de notificări
 * necitite": Romanian puts "de" between a number and its noun when the
 * number's last two digits are 00 or 20-99.
 */
export function unreadPhrase(count: number): string {
  if (count === 1) return "o notificare necitită";
  const lastTwo = count % 100;
  const de = count !== 0 && (lastTwo === 0 || lastTwo >= 20) ? "de " : "";
  return `${count} ${de}notificări necitite`;
}

export function renderDigest(input: DigestInput): RenderedDigest {
  const { origin } = input;
  const name = oneLine(input.name) || "membru OSUBB";
  const count = Math.max(input.unreadCount, input.items.length);
  const phrase = unreadPhrase(count);
  const listUrl = new URL(NOTIFICATIONS_PATH, origin).href;
  const optOutUrl = new URL(OPT_OUT_PATH, origin).href;
  const more = count - input.items.length;

  const lines = input.items.map((item) => ({
    title: oneLine(item.title),
    body: excerpt(item.body),
    when: when(item.created_at),
    // #1012: with the id, so following the line reads the Notification.
    url: notificationUrl(item.link, origin, item.id),
  }));

  const text = [
    `Salut, ${name}!`,
    "",
    `Ai ${phrase} în aplicația OSUBB:`,
    "",
    ...lines.flatMap((line) => [
      `- ${line.title}${line.when ? ` (${line.when})` : ""}`,
      ...(line.body ? [`  ${line.body}`] : []),
      `  ${line.url}`,
      "",
    ]),
    ...(more > 0 ? [`Și încă ${more} în aplicație.`, ""] : []),
    `Toate notificările: ${listUrl}`,
    "",
    "--",
    "Primești acest rezumat pentru că l-ai activat în Profil. " +
    `Îl oprești oricând de la „Rezumat zilnic pe email”: ${optOutUrl}`,
    "",
  ].join("\n");

  const itemHtml = lines.map((line) =>
    `<li style="margin: 0 0 16px">` +
    `<a href="${
      escapeHtml(line.url)
    }" style="color: #0b3d91; font-weight: 600">` +
    `${escapeHtml(line.title)}</a>` +
    (line.when
      ? ` <span style="color: #5b6170; font-size: 14px">${
        escapeHtml(line.when)
      }</span>`
      : "") +
    (line.body
      ? `<br><span style="color: #3a3f4b">${escapeHtml(line.body)}</span>`
      : "") +
    `</li>`
  ).join("");

  const html = `<!doctype html>
<html lang="ro">
<head><meta charset="utf-8"><title>${escapeHtml(`Ai ${phrase}`)}</title></head>
<body style="margin: 0; padding: 24px; background: #ffffff">
<div style="font-family: Montserrat, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #16181d; max-width: 560px">
<p style="margin: 0 0 16px">Salut, ${escapeHtml(name)}!</p>
<p style="margin: 0 0 16px">Ai <strong>${
    escapeHtml(phrase)
  }</strong> în aplicația OSUBB:</p>
<ul style="margin: 0 0 16px; padding-left: 20px">${itemHtml}</ul>
${
    more > 0
      ? `<p style="margin: 0 0 16px">Și încă ${more} în aplicație.</p>\n`
      : ""
  }<p style="margin: 0 0 24px"><a href="${
    escapeHtml(listUrl)
  }" style="display: inline-block; padding: 12px 20px; border-radius: 8px; background: #0b3d91; color: #ffffff; text-decoration: none; font-weight: 600">Deschide notificările</a></p>
<p style="margin: 0; font-size: 13px; color: #5b6170">Primești acest rezumat pentru că l-ai activat în Profil. Îl oprești oricând de la <a href="${
    escapeHtml(optOutUrl)
  }" style="color: #5b6170">„Rezumat zilnic pe email”</a>.</p>
</div>
</body>
</html>
`;

  return { subject: `Ai ${phrase}`, text, html };
}
