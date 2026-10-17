/**
 * Upload validation by content (magic bytes), never by file extension or
 * the client-supplied MIME type.
 */

export type DetectedType =
  | { kind: 'image'; mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/svg+xml'; ext: string }
  | { kind: 'font'; mime: 'font/woff' | 'font/woff2' | 'font/ttf' | 'font/otf'; ext: string };

export function detectType(buf: Buffer): DetectedType | null {
  if (buf.length < 12) return null;
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (hex.startsWith('ffd8ff')) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  const sig = buf.subarray(0, 4).toString('ascii');
  if (sig === 'wOFF') return { kind: 'font', mime: 'font/woff', ext: 'woff' };
  if (sig === 'wOF2') return { kind: 'font', mime: 'font/woff2', ext: 'woff2' };
  if (sig === 'OTTO') return { kind: 'font', mime: 'font/otf', ext: 'otf' };
  if (hex.startsWith('00010000') || sig === 'true') return { kind: 'font', mime: 'font/ttf', ext: 'ttf' };
  if (looksLikeSvg(buf)) return { kind: 'image', mime: 'image/svg+xml', ext: 'svg' };
  return null;
}

function looksLikeSvg(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (!head.startsWith('<')) return false;
  // Strip XML declaration, comments and doctype before looking for the root element.
  const body = head
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trimStart();
  return /^<svg[\s>]/i.test(body);
}

/** Read pixel dimensions from image headers (no image decoding library needed). */
export function imageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1]!;
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (mime === 'image/webp') {
      const chunk = buf.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      return null;
    }
    if (mime === 'image/svg+xml') {
      const head = buf.subarray(0, Math.min(buf.length, 8192)).toString('utf8');
      const tag = /<svg[^>]*>/i.exec(head)?.[0] ?? '';
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
      const w = /\swidth\s*=\s*["']([\d.]+)(px)?["']/i.exec(tag);
      const h = /\sheight\s*=\s*["']([\d.]+)(px)?["']/i.exec(tag);
      if (w && h) return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
      if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) };
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 8192;
