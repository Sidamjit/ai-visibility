/**
 * Builds tiny but structurally valid Office/PDF/email files in memory for
 * extraction tests (no binary fixtures in the repo). All identifiers used in
 * tests are published TEST values (IRD/NHI/bank examples, Visa test card).
 */
import { strToU8, zipSync } from 'fflate';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function docx(paragraphs: string[]): Uint8Array {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`)
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'word/document.xml': strToU8(
      `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`,
    ),
    'word/footer1.xml': strToU8(
      '<w:ftr xmlns:w="w"><w:p><w:r><w:t>IN-CONFIDENCE</w:t></w:r></w:p></w:ftr>',
    ),
  });
}

export function pptx(slides: string[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  slides.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(
      `<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>${esc(s)}</a:t></a:r></a:p></p:sld>`,
    );
  });
  return zipSync(files);
}

/** Sheet with shared strings in column A and NUMERIC cells in column B. */
export function xlsx(rows: Array<[string, number]>): Uint8Array {
  const shared = rows.map(([s]) => `<si><t>${esc(s)}</t></si>`).join('');
  const sheetRows = rows
    .map(
      ([, n], i) =>
        `<row r="${i + 1}"><c r="A${i + 1}" t="s"><v>${i}</v></c><c r="B${i + 1}"><v>${n}</v></c></row>`,
    )
    .join('');
  return zipSync({
    'xl/sharedStrings.xml': strToU8(`<sst count="${rows.length}">${shared}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  });
}

/** Minimal single-page PDF with correct xref offsets. */
export function pdf(lines: string[]): Uint8Array {
  const content = `BT /F1 12 Tf 72 720 Td 14 TL ${lines
    .map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*`)
    .join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

export function eml(body: string, attachment?: { name: string; bytes: Uint8Array }): Uint8Array {
  const b = 'BOUNDARY42';
  const att = attachment
    ? `--${b}\r\nContent-Type: application/octet-stream; name="${attachment.name}"\r\nContent-Disposition: attachment; filename="${attachment.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(attachment.bytes).toString('base64')}\r\n`
    : '';
  return strToU8(
    `From: hr@example.co.nz\r\nTo: payroll@example.co.nz\r\nSubject: Staff bank details\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${b}"\r\n\r\n--${b}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n${att}--${b}--\r\n`,
  );
}
