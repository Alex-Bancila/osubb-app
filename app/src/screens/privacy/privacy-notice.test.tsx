import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  PRIVACY_NOTICE_TITLE,
  PRIVACY_NOTICE_VERSION,
  PrivacyNoticeContent,
} from './PrivacyNoticeContent';

/*
 * The app's Privacy Notice is a copy of docs/legal/politica-de-confidentialitate.md
 * (#771). The document is the source of truth and every change to its text
 * bumps its version; these checks fail while the copy here says anything else
 * about the version, the sections or the placeholders still to fill.
 */
const markdown = readFileSync(
  path.resolve('../docs/legal/politica-de-confidentialitate.md'),
  'utf8',
);
// The leading HTML comment is the maintainers' note, not the notice.
const body = markdown.replace(/^<!--[\s\S]*?-->\s*/, '');

function placeholders(text: string) {
  return [...new Set(text.match(/\[\[[^\]]+\]\]/g) ?? [])].sort();
}

it('carries the same version as the document, at the top and at the end', () => {
  const top = body.match(/^\*\*Versiunea (\S+) · /m);
  const end = body.match(/^_Versiunea (\S+) — /m);
  expect(top?.[1]).toBe(PRIVACY_NOTICE_VERSION);
  expect(end?.[1]).toBe(PRIVACY_NOTICE_VERSION);

  render(<PrivacyNoticeContent />);
  expect(
    screen.getByText(`Versiunea ${PRIVACY_NOTICE_VERSION} · în vigoare de la`, {
      exact: false,
    }),
  ).toBeVisible();
});

it('has the document title and the same sections, in the same order', () => {
  expect(body.match(/^# (.+)$/m)?.[1]).toBe(PRIVACY_NOTICE_TITLE);
  const sections = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

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

it('leaves exactly the placeholders the document still has', () => {
  const { container } = render(<PrivacyNoticeContent />);
  expect(placeholders(container.textContent ?? '')).toEqual(placeholders(body));
});
