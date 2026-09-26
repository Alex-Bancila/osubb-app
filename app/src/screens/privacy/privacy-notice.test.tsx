import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  PRIVACY_NOTICE_DATE,
  PRIVACY_NOTICE_TITLE,
  PRIVACY_NOTICE_VERSION,
  PrivacyNoticeContent,
} from './PrivacyNoticeContent';

/*
 * The app's Privacy Notice is a copy of docs/legal/politica-de-confidentialitate.md
 * (#771). The document is the source of truth and every change to its text
 * bumps its version; these checks fail while the copy here says anything else
 * — a different version or date, a different section, or a different word.
 */
const markdown = readFileSync(
  path.resolve('../docs/legal/politica-de-confidentialitate.md'),
  'utf8',
);
// The leading HTML comment is the maintainers' note, not the notice.
const body = markdown.replace(/^<!--[\s\S]*?-->\s*/, '');

/**
 * The document's words with its Markdown taken out: headings, emphasis, links,
 * list markers, the table's pipes and rule lines. Whitespace is dropped on both
 * sides, since the rendered blocks sit next to each other without spaces.
 */
function markdownText(text: string) {
  return text
    .replace(/^#+ /gm, '')
    .replace(/^\|?[\s|:-]+\|?$/gm, '') // the table's separator and the closing rule
    .replace(/\|/g, '')
    .replace(/^- /gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|_/g, '')
    .replace(/\s+/g, '');
}

it('carries the same version and date as the document, at the top and at the end', () => {
  const top = body.match(/^\*\*Versiunea (\S+) · în vigoare de la (\S+)\*\*$/m);
  const end = body.match(/^_Versiunea (\S+) — (\S+)\. /m);
  expect(top?.slice(1)).toEqual([PRIVACY_NOTICE_VERSION, PRIVACY_NOTICE_DATE]);
  expect(end?.slice(1)).toEqual([PRIVACY_NOTICE_VERSION, PRIVACY_NOTICE_DATE]);

  render(<PrivacyNoticeContent />);
  expect(
    screen.getByText(`Versiunea ${PRIVACY_NOTICE_VERSION} · în vigoare de la`, {
      exact: false,
    }),
  ).toBeVisible();
  expect(screen.getAllByText(PRIVACY_NOTICE_DATE)).toHaveLength(2);
});

it('has the document title and the same ten sections, in the same order', () => {
  expect(body.match(/^# (.+)$/m)?.[1]).toBe(PRIVACY_NOTICE_TITLE);
  const sections = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  expect(sections).toHaveLength(10);

  render(<PrivacyNoticeContent />);
  expect(
    screen.getByRole('heading', { level: 1, name: PRIVACY_NOTICE_TITLE }),
  ).toBeVisible();
  expect(
    screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent),
  ).toEqual(sections);
});

it('renders exactly the words of the document', () => {
  const { container } = render(<PrivacyNoticeContent />);
  expect((container.textContent ?? '').replace(/\s+/g, '')).toBe(
    markdownText(body),
  );
});

it('lists the processors as a table and links the contact address', () => {
  render(<PrivacyNoticeContent />);
  const processors = screen.getByRole('table', {
    name: 'Persoane împuternicite',
  });
  expect(
    [...processors.querySelectorAll('th[scope="row"]')].map(
      (cell) => cell.textContent,
    ),
  ).toEqual(['Supabase, Inc.', 'Resend, Inc.', 'Cloudflare, Inc.']);
  const links = screen.getAllByRole('link', { name: 'it@osubb.ro' });
  expect(links).toHaveLength(3);
  for (const link of links)
    expect(link).toHaveAttribute('href', 'mailto:it@osubb.ro');
});
