import { load } from 'cheerio';

/**
 * Convert an HTML fragment to plain text using a real parser (cheerio).
 * `<br>` and closing `</p>`, `</div>`, `</li>` become line breaks; all
 * entities are decoded exactly once (so `&amp;lt;` stays `&lt;`).
 */
export function htmlToText(s: string): string {
  const $ = load(s, null, false);
  $('br').replaceWith('\n');
  $('p, div, li').each((_, el) => {
    $(el).append('\n');
  });
  return $.root()
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
