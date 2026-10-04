/**
 * S3 저장소 (운영). PutObject(ACL 지정 안 함 — 버킷 정책을 따른다) / GetObject / DeleteObject.
 * 자격 증명은 AWS SDK 기본 체인(AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY 환경변수 또는 IAM 역할)을 사용한다.
 */
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Storage } from './index.js';
import { assertValidKey, isValidKey } from './keys.js';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** 비우면 https://<bucket>.s3.<region>.amazonaws.com */
  publicBaseUrl?: string | null;
  /** 테스트 등에서 클라이언트 주입 */
  client?: S3Client;
}

function isNoSuchKey(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NoSuchKey' || e.Code === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404;
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

export class S3Storage implements Storage {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly baseUrl: string;

  constructor(opts: S3StorageOptions) {
    this.bucket = opts.bucket;
    this.client = opts.client ?? new S3Client({ region: opts.region });
    this.baseUrl = (opts.publicBaseUrl || `https://${opts.bucket}.s3.${opts.region}.amazonaws.com`).replace(/\/+$/, '');
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    assertValidKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNoSuchKey(err)) return null;
      throw err;
    }
  }

  async getStream(key: string): Promise<Readable | null> {
    assertValidKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      // Node.js 런타임에서 Body 는 Readable(IncomingMessage) 이다.
      return (res.Body as Readable | undefined) ?? null;
    } catch (err) {
      if (isNoSuchKey(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    assertValidKey(key);
    return `${this.baseUrl}/${encodeKey(key)}`;
  }

  keyFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const prefix = `${this.baseUrl}/`;
    if (!url.startsWith(prefix) || url.includes('?') || url.includes('#')) return null;
    let key: string;
    try {
      key = url.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
    } catch {
      return null;
    }
    return isValidKey(key) ? key : null;
  }
}
