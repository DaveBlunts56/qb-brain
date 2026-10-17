import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createId, TEMPLATE_ASSETS } from '@bf/shared';
import type { AssetRecord, Store } from '../db/store.js';
import { badRequest } from '../http/errors.js';
import { detectType, imageSize, MAX_IMAGE_DIMENSION, MAX_UPLOAD_BYTES } from '../http/uploads.js';
import { logger } from '../logger.js';

const log = logger('assets');

export class AssetService {
  readonly dir: string;

  constructor(
    private readonly store: Store,
    dataDir: string,
  ) {
    this.dir = path.join(dataDir, 'assets');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** Validate by content and store. Throws HttpError(400) for anything unsupported. */
  save(buf: Buffer, originalName: string, projectId: string | null, fixedId?: string): AssetRecord {
    if (buf.length === 0) throw badRequest('The file is empty.');
    if (buf.length > MAX_UPLOAD_BYTES) throw badRequest(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
    const type = detectType(buf);
    if (!type) throw badRequest(`"${originalName}" is not a supported file. Use PNG, JPEG, WebP, GIF, SVG, or WOFF/WOFF2/TTF/OTF fonts. (PSD files are imported in the Studio.)`);
    let size: { width: number; height: number } | null = null;
    if (type.kind === 'image') {
      size = imageSize(buf, type.mime);
      if (size && (size.width > MAX_IMAGE_DIMENSION || size.height > MAX_IMAGE_DIMENSION))
        throw badRequest(`Image is ${size.width}×${size.height}; the maximum is ${MAX_IMAGE_DIMENSION} px per side.`);
      if (type.mime !== 'image/svg+xml' && !size) throw badRequest(`"${originalName}" looks corrupted (could not read its dimensions).`);
    }
    const id = fixedId ?? createId('asset');
    const filename = `${id}.${type.ext}`;
    fs.writeFileSync(path.join(this.dir, filename), buf);
    const rec: AssetRecord = {
      id,
      projectId,
      kind: type.kind,
      mime: type.mime,
      filename,
      originalName: originalName.slice(0, 200) || filename,
      size: buf.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      createdAt: Date.now(),
    };
    this.store.insertAsset(rec);
    return rec;
  }

  filePath(a: AssetRecord): string {
    return path.join(this.dir, path.basename(a.filename));
  }

  read(id: string): { record: AssetRecord; data: Buffer } | null {
    const record = this.store.getAsset(id);
    if (!record) return null;
    try {
      return { record, data: fs.readFileSync(this.filePath(record)) };
    } catch {
      return null;
    }
  }

  delete(id: string): boolean {
    const rec = this.store.deleteAsset(id);
    if (!rec) return false;
    this.deleteFiles([rec.filename]);
    return true;
  }

  deleteFiles(filenames: string[]) {
    for (const f of filenames) {
      try {
        fs.unlinkSync(path.join(this.dir, path.basename(f)));
      } catch {
        /* already gone */
      }
    }
  }

  /** Install the example template's logos as shared assets (idempotent). */
  seedTemplateAssets() {
    for (const a of TEMPLATE_ASSETS) {
      const existing = this.store.getAsset(a.id);
      if (existing && fs.existsSync(this.filePath(existing))) continue;
      if (existing) this.store.deleteAsset(a.id);
      this.save(Buffer.from(a.content, 'utf8'), a.name, null, a.id);
      log.info(`Installed template asset ${a.name}`);
    }
  }
}
