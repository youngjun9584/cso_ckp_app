/**
 * 사진 저장소 인터페이스 (로컬 디스크 / S3 공통).
 *
 * 키 규칙: 영문·숫자·`/ . _ -` 만, `..`·빈 경로 조각·선행 `/` 금지 (assertValidKey).
 * EDI 키: ediObjectKeys(prefix, 'YYYYMM', uploadId) → `${prefix}/edi/${YYYYMM}/${uploadId}.jpg` / `..._thumb.jpg`
 */
import type { Readable } from 'node:stream';
import type { AppConfig } from '../config.js';
import { StorageKeyError, assertValidKey, isValidKey } from './keys.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';

export type StorageDriverName = 's3' | 'local';

export interface Storage {
  readonly driver: StorageDriverName;
  /** 객체 저장(같은 키는 덮어씀) */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** 없으면 null */
  getBuffer(key: string): Promise<Buffer | null>;
  /** 스트림 읽기(선택). 없으면 null */
  getStream?(key: string): Promise<Readable | null>;
  /** 삭제(없어도 오류 아님) */
  delete(key: string): Promise<void>;
  /**
   * edi.aws_url 에 기록할 공개 URL.
   * S3: S3_PUBLIC_BASE_URL/<key> 또는 https://<bucket>.s3.<region>.amazonaws.com/<key> (쿼리스트링 없음)
   * local: 'local:' + key (관리자 화면에서는 보이지 않는 개발용 표식)
   */
  publicUrl(key: string): string | null;
  /** publicUrl 로 만든 값(edi.aws_url)을 다시 저장소 키로 되돌린다. 이 저장소의 URL 이 아니면 null */
  keyFromUrl(url: string | null | undefined): string | null;
}

/** EDI 업로드 원본·썸네일 키 */
export function ediObjectKeys(prefix: string, yyyymm: string, uploadId: string): { objectKey: string; thumbKey: string } {
  const base = `${prefix.replace(/^\/+|\/+$/g, '')}/edi/${yyyymm}/${uploadId}`;
  return { objectKey: `${base}.jpg`, thumbKey: `${base}_thumb.jpg` };
}

export function createStorage(config: AppConfig): Storage {
  if (config.storage.driver === 's3') {
    return new S3Storage({
      bucket: config.storage.s3.bucket as string,
      region: config.storage.s3.region,
      publicBaseUrl: config.storage.s3.publicBaseUrl,
    });
  }
  return new LocalStorage(config.storage.localDir);
}

export { LocalStorage, S3Storage, StorageKeyError, assertValidKey, isValidKey };
