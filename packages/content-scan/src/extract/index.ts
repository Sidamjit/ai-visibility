/**
 * Text extraction from file bytes, entirely in memory.
 *
 * Supported: docx, xlsx, pptx (Office Open XML via fflate), pdf (unpdf /
 * PDF.js), eml (postal-mime), msg (msgreader), and plain-text formats.
 * Email attachments of supported types are extracted one level deep.
 *
 * Safety limits:
 *  - zip-bomb guard: total declared uncompressed size of the parts we read is capped,
 *  - text is truncated at `maxChars`,
 *  - legacy binary Office (.doc/.xls) and IRM/password-protected Office files
 *    (OLE compound files) are reported as unsupported/encrypted, not parsed.
 *
 * The caller owns the bytes and is responsible for discarding them.
 */
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { htmlToText, ooxmlToText, sharedStringsToText, worksheetToText } from './xml';

export interface ExtractOptions {
  maxChars: number;
  /** Max total uncompressed bytes read from an OOXML zip. */
  maxUncompressedBytes?: number;
}

export interface ExtractResult {
  text: string;
  truncated: boolean;
  /** Non-fatal notes, e.g. "2 attachments skipped". */
  notes: string[];
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly reason: 'unsupported' | 'encrypted' | 'corrupt' | 'too-large',
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

const decoder = (label: string) => new TextDecoder(label, { fatal: false });

/** Decode text with BOM detection (UTF-8 default, UTF-16 LE/BE when marked). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decoder('utf-16be').decode(bytes.subarray(2));
  return decoder('utf-8').decode(bytes);
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
const isOle = (b: Uint8Array) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

function unzipParts(bytes: Uint8Array, wanted: RegExp, limit: number): Record<string, string> {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f: UnzipFileInfo) => {
        if (!wanted.test(f.name)) return false;
        total += f.originalSize;
        if (total > limit)
          throw new ExtractionError('Uncompressed content exceeds limit', 'too-large');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError(`Corrupt Office file: ${(err as Error).message}`, 'corrupt');
  }
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) out[name] = decoder('utf-8').decode(data);
  return out;
}

const byNaturalName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

function extractOoxml(bytes: Uint8Array, ext: 'docx' | 'xlsx' | 'pptx', limit: number): string {
  if (isOle(bytes))
    throw new ExtractionError('Encrypted (IRM/password) or legacy Office file', 'encrypted');
  if (!isZip(bytes)) throw new ExtractionError('Not an Office Open XML file', 'corrupt');
  if (ext === 'docx') {
    const parts = unzipParts(
      bytes,
      /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/,
      limit,
    );
    const order = Object.keys(parts).sort((a, b) =>
      a.includes('document') ? -1 : b.includes('document') ? 1 : byNaturalName(a, b),
    );
    return order.map((k) => ooxmlToText(parts[k]!)).join('\n');
  }
  if (ext === 'pptx') {
    const parts = unzipParts(
      bytes,
      /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/,
      limit,
    );
    return Object.keys(parts)
      .sort(byNaturalName)
      .map((k) => ooxmlToText(parts[k]!))
      .join('\n');
  }
  const parts = unzipParts(bytes, /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/, limit);
  const shared = parts['xl/sharedStrings.xml'];
  const sheets = Object.keys(parts)
    .filter((k) => k.startsWith('xl/worksheets/'))
    .sort(byNaturalName)
    .map((k) => worksheetToText(parts[k]!));
  return [shared ? sharedStringsToText(shared) : '', ...sheets].join('\n');
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  try {
    // Copy: PDF.js may transfer/detach the buffer it is given.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    await pdf.cleanup();
    return text;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/password|encrypt/i.test(msg))
      throw new ExtractionError('Password-protected PDF', 'encrypted');
    throw new ExtractionError(`Unreadable PDF: ${msg}`, 'corrupt');
  }
}

async function extractAttachments(
  attachments: Array<{ name: string; bytes: Uint8Array }>,
  opts: ExtractOptions,
  notes: string[],
): Promise<string[]> {
  const out: string[] = [];
  let skipped = 0;
  for (const a of attachments) {
    const ext = extensionOf(a.name);
    if (!ext || !EXTRACTABLE.has(ext) || ext === 'eml' || ext === 'msg') {
      skipped++;
      continue;
    }
    try {
      out.push((await extractText(a.bytes, ext, opts)).text);
    } catch {
      skipped++;
    }
  }
  if (skipped) notes.push(`${skipped} attachment(s) not extracted`);
  return out;
}

async function extractEml(
  bytes: Uint8Array,
  opts: ExtractOptions,
  notes: string[],
): Promise<string> {
  const { default: PostalMime } = await import('postal-mime');
  const email = await PostalMime.parse(bytes, { attachmentEncoding: 'arraybuffer' } as never);
  const body = email.text ?? (email.html ? htmlToText(email.html) : '');
  const attachments = (email.attachments ?? [])
    .filter((a) => a.filename && typeof a.content !== 'string')
    .map((a) => ({ name: a.filename!, bytes: new Uint8Array(a.content as ArrayBuffer) }));
  const parts = await extractAttachments(attachments, opts, notes);
  return [email.subject ?? '', body, ...parts].join('\n');
}

async function extractMsg(
  bytes: Uint8Array,
  opts: ExtractOptions,
  notes: string[],
): Promise<string> {
  const { default: MsgReader } = await import('@kenjiuno/msgreader');
  if (!isOle(bytes)) throw new ExtractionError('Not an Outlook .msg file', 'corrupt');
  let reader: InstanceType<typeof MsgReader>;
  let data: ReturnType<InstanceType<typeof MsgReader>['getFileData']>;
  try {
    const copy = bytes.slice();
    reader = new MsgReader(copy.buffer as ArrayBuffer);
    data = reader.getFileData();
  } catch (err) {
    throw new ExtractionError(`Unreadable .msg: ${(err as Error).message}`, 'corrupt');
  }
  const body = data.body ?? (data.bodyHtml ? htmlToText(data.bodyHtml) : '');
  const attachments = (data.attachments ?? []).flatMap((a) => {
    try {
      const att = reader.getAttachment(a);
      return att.fileName ? [{ name: att.fileName, bytes: att.content }] : [];
    } catch {
      return [];
    }
  });
  const parts = await extractAttachments(attachments, opts, notes);
  return [data.subject ?? '', body, ...parts].join('\n');
}

const TEXT_EXTS = new Set(['txt', 'csv', 'md', 'json', 'xml', 'log', 'tsv']);
export const EXTRACTABLE = new Set([
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'eml',
  'msg',
  'html',
  'htm',
  ...TEXT_EXTS,
]);

/** Lower-case extension without the dot ('' when none). */
export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

/** Extract text from file bytes. Throws ExtractionError for unsupported/encrypted/corrupt files. */
export async function extractText(
  bytes: Uint8Array,
  extension: string,
  opts: ExtractOptions,
): Promise<ExtractResult> {
  const ext = extension.toLowerCase();
  const notes: string[] = [];
  const limit = opts.maxUncompressedBytes ?? 200 * 1024 * 1024;
  let text: string;
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') text = extractOoxml(bytes, ext, limit);
  else if (ext === 'pdf') text = await extractPdf(bytes);
  else if (ext === 'eml') text = await extractEml(bytes, opts, notes);
  else if (ext === 'msg') text = await extractMsg(bytes, opts, notes);
  else if (ext === 'html' || ext === 'htm') text = htmlToText(decodeText(bytes));
  else if (TEXT_EXTS.has(ext)) text = decodeText(bytes);
  else throw new ExtractionError(`Unsupported file type ".${ext}"`, 'unsupported');

  const truncated = text.length > opts.maxChars;
  if (truncated) notes.push(`text truncated at ${opts.maxChars} characters`);
  return { text: truncated ? text.slice(0, opts.maxChars) : text, truncated, notes };
}
