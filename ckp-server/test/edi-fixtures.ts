/**
 * EDI 테스트 공용 도우미 (edi*.test.ts, files.test.ts). 모든 데이터는 인메모리 PGlite + 임시 로컬 저장소.
 */
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import sharp from 'sharp';
import { expect } from 'vitest';
import type { ApiErrorBody, EdiSubmissionCreateRequest, EdiSubmissionCreateResponse, EdiUploadResponse } from '../src/contract.js';
import type { TestContext } from './helpers.js';

export interface MultipartFile {
  name: string;
  type: string;
  data: Buffer;
}

/** multipart/form-data 본문. fileFirst=true 면 파일 part 를 필드보다 먼저 넣는다 */
export function multipart(fields: Record<string, string>, file?: MultipartFile, fileFirst = false) {
  const boundary = `----ckp${randomUUID().replace(/-/g, '')}`;
  const fieldParts = Object.entries(fields).map(([k, v]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
  );
  const fileParts = file
    ? [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`),
        file.data,
        Buffer.from('\r\n'),
      ]
    : [];
  const parts = fileFirst ? [...fileParts, ...fieldParts] : [...fieldParts, ...fileParts];
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

let hue = 0;

/** 서로 다른 내용의 JPEG (기본 800x600) */
export async function jpeg(width = 800, height = 600, opts: { orientation?: number } = {}): Promise<Buffer> {
  hue = (hue + 37) % 360;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="hsl(${hue},60%,70%)"/>` +
      `<rect x="0" y="0" width="${Math.round(width / 4)}" height="${Math.round(height / 4)}" fill="hsl(${(hue + 180) % 360},60%,30%)"/>` +
      `</svg>`,
  );
  let img = sharp(svg).jpeg({ quality: 80 });
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return img.toBuffer();
}

export interface UploadOptions {
  clientPhotoId?: string;
  data?: Buffer;
  name?: string;
  type?: string;
  fileFirst?: boolean;
  omitFile?: boolean;
  omitClientPhotoId?: boolean;
}

export async function uploadRaw(t: TestContext, usrId: string, o: UploadOptions = {}): Promise<LightMyRequestResponse> {
  const fields: Record<string, string> = o.omitClientPhotoId ? {} : { clientPhotoId: o.clientPhotoId ?? randomUUID() };
  const file = o.omitFile ? undefined : { name: o.name ?? 'photo.jpg', type: o.type ?? 'image/jpeg', data: o.data ?? (await jpeg()) };
  const mp = multipart(fields, file, o.fileFirst);
  return t.app.inject({
    method: 'POST',
    url: '/v1/edi/uploads',
    payload: mp.payload,
    headers: { ...mp.headers, ...(await t.authHeaders(usrId)) },
  });
}

/** 업로드 성공(201)을 확인하고 응답을 돌려준다 */
export async function uploadOk(t: TestContext, usrId = 'ckp_demo', o: UploadOptions = {}): Promise<EdiUploadResponse['upload']> {
  const res = await uploadRaw(t, usrId, o);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<EdiUploadResponse>().upload;
}

export async function submitRaw(
  t: TestContext,
  usrId: string,
  body: EdiSubmissionCreateRequest | Record<string, unknown>,
  key: string | null = randomUUID(),
): Promise<LightMyRequestResponse> {
  return t.app.inject({
    method: 'POST',
    url: '/v1/edi/submissions',
    payload: body,
    headers: { ...(await t.authHeaders(usrId)), ...(key === null ? {} : { 'idempotency-key': key }) },
  });
}

export async function submitOk(t: TestContext, usrId: string, body: EdiSubmissionCreateRequest, key: string = randomUUID()) {
  const res = await submitRaw(t, usrId, body, key);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<EdiSubmissionCreateResponse>().submission;
}

export function errorOf(res: LightMyRequestResponse): ApiErrorBody['error'] {
  return res.json<ApiErrorBody>().error;
}

/** 거래처 idx (seed 거래처명으로 조회) */
export async function clientIdx(t: TestContext, usrId: string, name: string): Promise<number> {
  const { rows } = await t.db.query<{ idx: number }>('SELECT idx FROM public.mannager_by_hospital WHERE user_id = $1 AND hospital = $2', [usrId, name]);
  const idx = rows[0]?.idx;
  if (typeof idx !== 'number') throw new Error(`거래처 없음: ${usrId}/${name}`);
  return idx;
}

export async function count(t: TestContext, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await t.db.query<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/** 절대 URL → inject 용 경로 */
export function pathOf(url: string): string {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

export async function getFile(t: TestContext, url: string): Promise<LightMyRequestResponse> {
  return t.app.inject({ method: 'GET', url: pathOf(url) });
}

/** 저장소 폴더 아래 파일 목록 (상대 경로) */
export async function listStoredFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  await walk(root);
  return out.sort();
}

/** 파일 여러 장 올리기 */
export async function uploadMany(t: TestContext, usrId: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await uploadOk(t, usrId)).uploadId);
  return ids;
}

export function photosOf(uploadIds: string[]): { uploadId: string; seq: number }[] {
  return uploadIds.map((uploadId, i) => ({ uploadId, seq: i + 1 }));
}
