/** 저장소 키 검증 (local/s3 공통) */

const KEY_RE = /^[A-Za-z0-9._\-/]+$/;

export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`허용되지 않는 저장소 키: ${key.slice(0, 80)}`);
    this.name = 'StorageKeyError';
  }
}

export function isValidKey(key: string): boolean {
  if (!key || key.length > 512 || !KEY_RE.test(key) || key.startsWith('/')) return false;
  return key.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

export function assertValidKey(key: string): void {
  if (!isValidKey(key)) throw new StorageKeyError(key);
}
