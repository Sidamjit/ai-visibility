/** Minimal XML-to-text helpers for Office Open XML parts (no DOM needed). */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/**
 * Convert WordprocessingML / DrawingML XML to text: paragraph, row and break
 * elements become newlines, cells become tabs, all other tags are dropped.
 */
export function ooxmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<(w:tab|w:br|a:br)\b[^>]*\/>/g, ' ')
      .replace(/<\/(w:p|a:p|w:tr)>/g, '\n')
      .replace(/<\/w:tc>/g, '\t')
      .replace(/<[^>]+>/g, ''),
  );
}

/** Strip HTML to text (for .html files and HTML email bodies). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)\b[^>]*>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<[^>]+>/g, ' '),
  );
}

/**
 * Extract cell text from a SpreadsheetML worksheet. Shared-string cells
 * (t="s") are skipped — their text is read from sharedStrings.xml — but numeric
 * and inline-string cells are kept, because identifiers (IRD, bank numbers) are
 * often stored as numbers.
 */
export function worksheetToText(xml: string): string {
  const rows: string[] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? '';
      const body = cell[2] ?? '';
      if (/\bt="s"/.test(attrs)) continue;
      const inline = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
      const value = inline?.[1] ?? body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (value) cells.push(decodeEntities(value));
    }
    if (cells.length) rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}

/** Shared strings table: one string per <si>. */
export function sharedStringsToText(xml: string): string {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((si) =>
      [...si[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeEntities(t[1]!)).join(''),
    )
    .join('\n');
}
