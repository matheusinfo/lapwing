/**
 * A small Markdown renderer for the coach's answers: headings, paragraphs,
 * bullet and numbered lists (one nesting level), tables, code, quotes, bold,
 * italic, inline code and http(s) links. Everything is escaped first, so the
 * output never contains HTML from the text itself. Works on partial text
 * while an answer is streaming in.
 */

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Inline formatting on already-escaped text. */
function inline(text: string): string {
  const codes: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[+i]);
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function alignments(sep: string): string[] {
  return cells(sep).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
}

export function renderMarkdown(source: string): string {
  const lines = esc(source.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block (may still be open while streaming).
    if (/^\s*```/.test(line)) {
      flushParagraph();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre><code>${code.join('\n')}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min(6, heading[1].length + 2); // # → h3: the screen already has h1/h2.
      out.push(`<h${level}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      out.push('<hr>');
      continue;
    }

    // Table: a header row followed by a separator row.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushParagraph();
      const head = cells(line);
      const align = alignments(lines[i + 1]);
      const attr = (c: number) => (align[c] ? ` style="text-align:${align[c]}"` : '');
      const rows: string[] = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) {
        rows.push(`<tr>${cells(lines[i]).map((c, n) => `<td${attr(n)}>${inline(c)}</td>`).join('')}</tr>`);
      }
      i--;
      out.push(
        `<div class="cch-table"><table><thead><tr>${head.map((c, n) => `<th${attr(n)}>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.join('')}</tbody></table></div>`,
      );
      continue;
    }

    if (/^&gt;\s?/.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      for (; i < lines.length && /^&gt;\s?/.test(lines[i]); i++) quote.push(inline(lines[i].replace(/^&gt;\s?/, '')));
      i--;
      out.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const ordered = /\d/.test(item[2]);
      const baseIndent = item[1].length;
      const items: string[] = [];
      let nested: string[] = [];
      let nestedOrdered = false;
      const closeNested = () => {
        if (!nested.length || !items.length) return;
        const tag = nestedOrdered ? 'ol' : 'ul';
        items[items.length - 1] += `<${tag}>${nested.map((n) => `<li>${n}</li>`).join('')}</${tag}>`;
        nested = [];
      };
      for (; i < lines.length; i++) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m && m[1].length > baseIndent) {
          nestedOrdered = /\d/.test(m[2]);
          nested.push(inline(m[3]));
        } else if (m) {
          closeNested();
          items.push(inline(m[3]));
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
          // Continuation line of the previous item.
          if (nested.length) nested[nested.length - 1] += ` ${inline(lines[i].trim())}`;
          else items[items.length - 1] += ` ${inline(lines[i].trim())}`;
        } else break;
      }
      closeNested();
      i--;
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered && parseInt(item[2], 10) !== 1 ? ` start="${parseInt(item[2], 10)}"` : '';
      out.push(`<${tag}${start}>${items.map((x) => `<li>${x}</li>`).join('')}</${tag}>`);
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  return out.join('');
}
