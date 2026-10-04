/**
 * 로컬 디스크 저장소 (개발·테스트용). LOCAL_STORAGE_DIR 아래에만 쓴다(경로 이탈 차단).
 */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { Storage } from './index.js';
import { StorageKeyError, assertValidKey } from './keys.js';

const LOCAL_PREFIX = 'local:';

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export class LocalStorage implements Storage {
  readonly driver = 'local' as const;
  readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /** 키 → 절대 경로 (루트 밖이면 오류) */
  resolvePath(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, ...key.split('/'));
    const rel = path.relative(this.root, full);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new StorageKeyError(key);
    return full;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const full = this.resolvePath(key);
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${randomUUID()}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, full);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolvePath(key));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async getStream(key: string): Promise<Readable | null> {
    const full = this.resolvePath(key);
    try {
      const s = await stat(full);
      if (!s.isFile()) return null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
    return createReadStream(full);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }

  publicUrl(key: string): string {
    assertValidKey(key);
    return `${LOCAL_PREFIX}${key}`;
  }

  keyFromUrl(url: string | null | undefined): string | null {
    if (!url || !url.startsWith(LOCAL_PREFIX)) return null;
    const key = url.slice(LOCAL_PREFIX.length);
    try {
      this.resolvePath(key);
      return key;
    } catch {
      return null;
    }
  }
}
