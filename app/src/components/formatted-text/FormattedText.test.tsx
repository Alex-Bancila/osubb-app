import * as axe from 'axe-core';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { FormattedText } from './FormattedText';

const SAMPLE = 'Ne vedem **joi**.\n\n## Ordinea de zi\n- unu\n- doi';

function full(text: string) {
  return render(
    <MemoryRouter>
      <FormattedText text={text} view="full" />
    </MemoryRouter>,
  ).container;
}

function preview(text: string) {
  return render(<FormattedText text={text} view="preview" />).container;
}

describe('FormattedText, full (ruling R60)', () => {
  it('reads bold, a Subtitlu and a bulleted list', async () => {
    const container = full(SAMPLE);
    expect(container.querySelector('strong')).toHaveTextContent('joi');
    expect(container.querySelector('h4')).toHaveTextContent('Ordinea de zi');
    expect(
      [...container.querySelectorAll('li')].map((li) => li.textContent),
    ).toEqual(['unu', 'doi']);
    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });

  it('wraps the text in one div.formatted-text, with the caller’s class', () => {
    const { container } = render(
      <FormattedText text="text" view="full" className="text-sm" />,
    );
    expect(container.firstElementChild?.tagName).toBe('DIV');
    expect(container.firstElementChild).toHaveClass(
      'formatted-text',
      'text-sm',
    );
  });

  it('shows raw HTML as text and never runs it', () => {
    const container = full(
      '<script>x</script>\n\n<img src=x onerror=alert(1)>',
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<script>x</script>');
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('shows a javascript: link as it was typed, with no link', () => {
    const container = full('[rău](javascript:alert(1))');
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('[rău](javascript:alert(1))');
  });

  it('opens a bare address in a new tab, cut off from this page', () => {
    full('https://osubb.ro');
    const link = screen.getByRole('link', { name: 'https://osubb.ro' });
    expect(link).toHaveAttribute('href', 'https://osubb.ro');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens a Text Link to the app inside the app', () => {
    full(`Vezi [ședința](${location.origin}/calendar?event=1).`);
    const link = screen.getByRole('link', { name: 'ședința' });
    expect(link).toHaveAttribute('href', '/calendar?event=1');
    expect(link).not.toHaveAttribute('target');
  });

  it('reads a reference link and a www. address as text', () => {
    const container = full('[x][r] și www.osubb.ro\n\n[r]: https://osubb.ro');
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('[x][r] și www.osubb.ro');
    expect(container).toHaveTextContent('[r]: https://osubb.ro');
  });

  it('keeps an old text’s line breaks and reads its dash as one list item', () => {
    const container = full('rând unu\nrând doi\n- punct');
    const paragraph = container.querySelector('p');
    expect(paragraph?.querySelector('br')).not.toBeNull();
    expect(paragraph).toHaveTextContent('rând unurând doi');
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.querySelector('li')).toHaveTextContent('punct');
  });

  it('shows --- as it was typed', () => {
    const container = full('---');
    expect(container.querySelector('hr')).toBeNull();
    expect(container.querySelector('p')).toHaveTextContent(/^---$/);
  });

  it('reads # as a Titlu (h3) and ## or deeper as a Subtitlu (h4)', () => {
    const container = full('# Titlu\n## Sub\n### Mic');
    expect(container.querySelector('h3')).toHaveTextContent('Titlu');
    expect(
      [...container.querySelectorAll('h4')].map((h) => h.textContent),
    ).toEqual(['Sub', 'Mic']);
    expect(container.querySelector('h1, h2, h5, h6')).toBeNull();
  });

  it('shows a heading written with === under it as typed', () => {
    const container = full('Titlu\n===');
    expect(container.querySelector('h3, h4')).toBeNull();
    const paragraph = container.querySelector('p');
    expect(paragraph?.querySelector('br')).not.toBeNull();
    expect(paragraph).toHaveTextContent('Titlu===');
  });

  it('reads quotes, numbered and nested lists', () => {
    const container = full('> citat\n\n3. trei\n4. patru\n\n- unu\n  - doi');
    expect(container.querySelector('blockquote')).toHaveTextContent('citat');
    expect(container.querySelector('ol')).toHaveAttribute('start', '3');
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelector('ul ul li')).toHaveTextContent('doi');
  });

  it('reads strikethrough, highlight and both italics', () => {
    const container = full('~~vechi~~ ~tăiat~ ==nou== *a* _b_');
    expect(
      [...container.querySelectorAll('s')].map((s) => s.textContent),
    ).toEqual(['vechi', 'tăiat']);
    expect(container.querySelector('mark')).toHaveTextContent('nou');
    expect(
      [...container.querySelectorAll('em')].map((em) => em.textContent),
    ).toEqual(['a', 'b']);
  });

  it('pairs markers only at word edges', () => {
    const container = full('5*3*2 nume_prenume\n\n2 ** 3 ** 4\n\na == b == c');
    expect(container.querySelector('em, strong, mark')).toBeNull();
    expect(container).toHaveTextContent('5*3*2 nume_prenume');
    expect(container).toHaveTextContent('2 ** 3 ** 4');
    expect(container).toHaveTextContent('a == b == c');
  });

  it('highlights only within one line and with no = inside, as the stripper pairs ==', () => {
    expect(full('==a\nb==').querySelector('mark')).toBeNull();
    const equals = full('==a=b==');
    expect(equals.querySelector('mark')).toBeNull();
    expect(equals).toHaveTextContent('==a=b==');
    expect(full('==nou==').querySelector('mark')).toHaveTextContent(/^nou$/);
  });

  it('takes the innermost link, as the stripper does', () => {
    const container = full('[a [b](https://x.ro)');
    const paragraph = container.querySelector('p');
    expect(paragraph?.firstChild?.textContent).toBe('[a ');
    expect(paragraph?.querySelector('a')).toHaveTextContent(/^b$/);
    expect(paragraph?.querySelector('a')).toHaveAttribute(
      'href',
      'https://x.ro',
    );
  });
});

describe('FormattedText, preview (ruling R60)', () => {
  it('runs the blocks and list items into one line joined by " · "', () => {
    const container = preview(SAMPLE);
    expect(container).toHaveTextContent(
      /^Ne vedem joi\. · Ordinea de zi · unu · doi$/,
    );
    expect(container.querySelector('h4, ul, li, p')).toBeNull();
  });

  it('is one span.formatted-text-preview, with the caller’s class', () => {
    const { container } = render(
      <FormattedText text="text" view="preview" className="text-muted" />,
    );
    expect(container.firstElementChild?.tagName).toBe('SPAN');
    expect(container.firstElementChild).toHaveClass(
      'formatted-text-preview',
      'text-muted',
    );
  });

  it('keeps bold, italic, strikethrough and highlight', () => {
    const container = preview('**a** *b* ~~c~~ ==d==');
    expect(container.querySelector('strong')).toHaveTextContent('a');
    expect(container.querySelector('em')).toHaveTextContent('b');
    expect(container.querySelector('s')).toHaveTextContent('c');
    expect(container.querySelector('mark')).toHaveTextContent('d');
  });

  it('shows a link as its words and a line break as a space (ruling 14)', () => {
    const container = preview(
      'Vezi [formularul](https://forms.gle/x)\nși https://osubb.ro',
    );
    expect(container.querySelector('a, br')).toBeNull();
    expect(container).toHaveTextContent(
      /^Vezi formularul și https:\/\/osubb\.ro$/,
    );
  });

  it('shows an unsafe link and raw HTML as typed', () => {
    const container = preview('[rău](javascript:alert(1))\n\n<b>x</b>');
    expect(container.querySelector('a, b')).toBeNull();
    expect(container).toHaveTextContent(
      '[rău](javascript:alert(1)) · <b>x</b>',
    );
  });
});
