import fs from 'fs';
import path from 'path';

const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json', 'c', 'h', 'cpp', 'java', 'py', 'js', 'ts', 'html', 'css', 'sql', 'sh', 'ipynb']);

export interface Chunk { section: string; text: string }

export async function extractText(filePath: string, ext: string): Promise<string | null> {
  try {
    if (TEXT_EXT.has(ext)) return fs.readFileSync(filePath, 'utf8').slice(0, 2_000_000);
    if (ext === 'pdf') {
      const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default as (b: Buffer) => Promise<{ text: string }>;
      return (await pdf(fs.readFileSync(filePath))).text;
    }
    if (ext === 'docx') {
      const mammoth = await import('mammoth');
      return (await mammoth.extractRawText({ path: filePath })).value;
    }
  } catch {
    return null;
  }
  return null;
}

export const extOf = (name: string) => path.extname(name).slice(1).toLowerCase();

/** Split text into ~900 character chunks on paragraph boundaries, labelling each with the nearest heading. */
export function chunkText(raw: string, size = 900): Chunk[] {
  const text = raw.replace(/\r/g, '').replace(/\u0000/g, '');
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: Chunk[] = [];
  let buf = '';
  let heading = '';
  let bufHeading = '';
  const flush = () => { if (buf.trim()) chunks.push({ section: bufHeading, text: buf.trim() }); buf = ''; };
  for (const p of paras) {
    if (/^#{1,6}\s/.test(p) || (p.length < 80 && !/[.!?]$/.test(p) && p.split('\n').length === 1)) heading = p.replace(/^#+\s*/, '').slice(0, 80);
    if (!buf) bufHeading = heading;
    if (buf.length + p.length > size) {
      flush();
      bufHeading = heading;
    }
    if (p.length > size * 2) {
      for (let i = 0; i < p.length; i += size) chunks.push({ section: heading, text: p.slice(i, i + size) });
    } else buf += (buf ? '\n\n' : '') + p;
  }
  flush();
  return chunks.slice(0, 400);
}
