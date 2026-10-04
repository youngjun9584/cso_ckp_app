/**
 * GET /v1/files/:token — 서명 이미지 전달 (DESIGN §5.7)
 *  'u' 업로드 원장 / 'e' edi 행(현재 aws_url 기준: 앱 저장소 키, 'local:' 시드 키, 허용된 https, edi_image data URL)
 * 외부 https 는 실제로 접속하지 않고 fetch 를 가짜로 바꿔 확인한다.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiErrorBody, EdiSubmissionDetail, EdiSubmissionDetailResponse, EdiSubmissionListResponse } from '../src/contract.js';
import { clearThumbCache, decodeEdiImage, isAllowedLegacyUrl, LEGACY_FETCH_MAX_BYTES, thumbCacheSize } from '../src/domain/edi/images.js';
import { readImageMeta } from '../src/lib/image.js';
import { createTestApp, type TestContext } from './helpers.js';
import { clientIdx, getFile, jpeg, multipart, pathOf, photosOf, submitOk, uploadMany, uploadOk } from './edi-fixtures.js';

const NOW = '2026-09-15T03:00:00Z';
const LEGACY_PREFIX = 'https://legacy-img.example.com/edi/';

let t: TestContext;
let submission: EdiSubmissionDetail;
let uploadIds: string[];

async function objectKeys(uploadId: string) {
  const { rows } = await t.db.query<{ object_key: string; thumb_key: string }>(
    'SELECT object_key, thumb_key FROM public.ckp_app_edi_upload WHERE upload_id = $1',
    [uploadId],
  );
  return rows[0]!;
}

async function detailOf(usrId: string, id: string): Promise<EdiSubmissionDetail> {
  const res = await t.app.inject({ method: 'GET', url: `/v1/edi/submissions/${id}`, headers: await t.authHeaders(usrId) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<EdiSubmissionDetailResponse>().submission;
}

async function legacyDetail(ym: string, clientName: string): Promise<EdiSubmissionDetail> {
  const res = await t.app.inject({ method: 'GET', url: `/v1/edi/submissions?ym=${ym}`, headers: await t.authHeaders('ckp_demo') });
  const item = res.json<EdiSubmissionListResponse>().items.find((i) => i.kind === 'legacy' && i.clientName === clientName)!;
  return detailOf('ckp_demo', item.id);
}

function signEdi(idx: number, v: 'thumb' | 'full' = 'full', u = 'ckp_demo'): string {
  return `/v1/files/${t.app.deps.tokens.signFileToken({ k: 'e', id: idx, v, u })}`;
}

async function fetchPath(path: string) {
  return t.app.inject({ method: 'GET', url: path });
}

function expectNotFound(res: Awaited<ReturnType<typeof fetchPath>>) {
  expect(res.statusCode).toBe(404);
  const err = res.json<ApiErrorBody>().error;
  expect(err.code).toBe('NOT_FOUND');
  expect(err.message).toContain('이미지를 찾을 수 없거나 주소가 만료되었습니다');
}

beforeAll(async () => {
  t = await createTestApp({ now: NOW, env: { LEGACY_IMAGE_URL_PREFIXES: LEGACY_PREFIX } });
  uploadIds = await uploadMany(t, 'ckp_demo', 3);
  submission = await submitOk(t, 'ckp_demo', {
    clientIdx: await clientIdx(t, 'ckp_demo', '서울튼튼내과의원'),
    targetYm: '2026-08',
    photos: photosOf(uploadIds),
  });
});

afterAll(async () => {
  await t?.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearThumbCache();
});

describe('업로드 원장 이미지 (k=u)', () => {
  it('썸네일·원본: 200 image/jpeg, private 캐시, 다른 출처(웹 앱)에서 <img> 로 읽을 수 있음', async () => {
    const up = await uploadOk(t, 'ckp_demo', { data: await jpeg(1200, 900) });
    const keys = await objectKeys(up.uploadId);

    const thumb = await getFile(t, up.thumbUrl);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    expect(thumb.headers['cache-control']).toBe('private, max-age=3600');
    expect(thumb.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(thumb.headers['x-content-type-options']).toBe('nosniff');
    expect(thumb.rawPayload.equals((await t.storage.getBuffer(keys.thumb_key))!)).toBe(true);

    const full = await fetchPath(`/v1/files/${t.app.deps.tokens.signFileToken({ k: 'u', id: up.uploadId, v: 'full', u: 'ckp_demo' })}`);
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.equals((await t.storage.getBuffer(keys.object_key))!)).toBe(true);
    const meta = await readImageMeta(full.rawPayload);
    expect([meta.width, meta.height]).toEqual([1200, 900]);
  });

  it('제출에 쓰인(USED) 업로드의 썸네일도 계속 열린다', async () => {
    const res = await fetchPath(`/v1/files/${t.app.deps.tokens.signFileToken({ k: 'u', id: uploadIds[0]!, v: 'thumb', u: 'ckp_demo' })}`);
    expect(res.statusCode).toBe(200);
  });

  it('요청 Host 기준 절대 URL (다른 출처의 웹 앱에서도 그대로 사용)', async () => {
    const mp = multipart({ clientPhotoId: randomUUID() }, { name: 'a.jpg', type: 'image/jpeg', data: await jpeg() });
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/edi/uploads',
      payload: mp.payload,
      headers: { ...mp.headers, ...(await t.authHeaders('ckp_demo')), host: 'api.ckp.example.com:4000' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ upload: { thumbUrl: string } }>().upload.thumbUrl).toMatch(/^http:\/\/api\.ckp\.example\.com:4000\/v1\/files\/[\w-]+\.[\w-]+$/);
  });
});

describe('EDI 행 이미지 (k=e)', () => {
  it('앱 제출 사진: 원본 = 저장된 객체, 썸네일 = 저장된 _thumb', async () => {
    const p = submission.photos[0]!;
    const keys = await objectKeys(uploadIds[0]!);
    const full = await getFile(t, p.imageUrl!);
    expect(full.statusCode).toBe(200);
    expect(full.headers['cache-control']).toBe('private, max-age=3600');
    expect(full.rawPayload.equals((await t.storage.getBuffer(keys.object_key))!)).toBe(true);
    const thumb = await getFile(t, p.thumbUrl!);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.rawPayload.equals((await t.storage.getBuffer(keys.thumb_key))!)).toBe(true);
  });

  it('관리자가 crop 해 aws_url 을 다른 키로 바꾸면 현재 aws_url 의 이미지를 전달한다 (썸네일은 즉석 생성)', async () => {
    const p = submission.photos[1]!;
    const cropped = await jpeg(700, 1400);
    await t.storage.put('uploads/admin/crop/edi-crop-1.jpg', cropped, 'image/jpeg');
    const { rows } = await t.db.query<{ aws_url: string }>('SELECT aws_url FROM public.edi WHERE idx = $1', [p.ediIdx]);
    const original = rows[0]!.aws_url;
    await t.db.query("UPDATE public.edi SET aws_url = 'local:uploads/admin/crop/edi-crop-1.jpg' WHERE idx = $1", [p.ediIdx]);
    try {
      const full = await getFile(t, p.imageUrl!);
      expect(full.statusCode).toBe(200);
      expect(full.rawPayload.equals(cropped)).toBe(true);
      const thumb = await getFile(t, p.thumbUrl!);
      expect(thumb.statusCode).toBe(200);
      const meta = await readImageMeta(thumb.rawPayload);
      expect([meta.width, meta.height]).toEqual([240, 480]);
    } finally {
      await t.db.query('UPDATE public.edi SET aws_url = $2 WHERE idx = $1', [p.ediIdx, original]);
    }
  });

  describe('즉석 썸네일을 못 만드는 원본 (끝이 잘린 JPEG 등)', () => {
    async function withLocalImage<T>(key: string, data: Buffer, fn: (p: EdiSubmissionDetail['photos'][number]) => Promise<T>): Promise<T> {
      const p = submission.photos[1]!;
      await t.storage.put(key, data, 'image/jpeg');
      const { rows } = await t.db.query<{ aws_url: string }>('SELECT aws_url FROM public.edi WHERE idx = $1', [p.ediIdx]);
      await t.db.query('UPDATE public.edi SET aws_url = $2 WHERE idx = $1', [p.ediIdx, `local:${key}`]);
      try {
        return await fn(p);
      } finally {
        await t.db.query('UPDATE public.edi SET aws_url = $2 WHERE idx = $1', [p.ediIdx, rows[0]!.aws_url]);
      }
    }

    it('끝이 잘린 JPEG: 느슨한 설정으로 480 썸네일을 만들어 전달·캐시 (원본 크기를 캐시하지 않음)', async () => {
      const full = await jpeg(2000, 1500);
      const cut = full.subarray(0, Math.floor(full.length * 0.6));
      await withLocalImage('uploads/admin/crop/truncated.jpg', cut, async (p) => {
        expect(thumbCacheSize()).toBe(0);
        const thumb = await getFile(t, p.thumbUrl!);
        expect(thumb.statusCode).toBe(200);
        expect(thumb.headers['content-type']).toBe('image/jpeg');
        const meta = await readImageMeta(thumb.rawPayload);
        expect(Math.max(meta.width, meta.height)).toBe(480);
        expect(thumb.rawPayload.length).toBeLessThan(cut.length);
        expect(thumbCacheSize()).toBe(1);
      });
    });

    it('디코드할 수 없는 원본: 썸네일 주소는 원본을 그대로 주되 캐시에 넣지 않는다', async () => {
      const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4000, 7)]);
      await withLocalImage('uploads/admin/crop/broken.jpg', broken, async (p) => {
        const thumb = await getFile(t, p.thumbUrl!);
        expect(thumb.statusCode).toBe(200);
        expect(thumb.rawPayload.equals(broken)).toBe(true);
        expect(thumbCacheSize()).toBe(0);
        // 다시 요청해도 캐시 없이 같은 결과
        expect((await getFile(t, p.thumbUrl!)).rawPayload.equals(broken)).toBe(true);
        expect(thumbCacheSize()).toBe(0);
      });
    });
  });

  it("이전 방식 'local:' 시드 이미지: 원본 그대로, 썸네일은 긴 변 480 으로 생성", async () => {
    const a = await legacyDetail('2026-09', '서울튼튼내과의원');
    const full = await getFile(t, a.photos[0]!.imageUrl!);
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.equals((await t.storage.getBuffer('seed/edi/legacy-a-1.jpg'))!)).toBe(true);
    const thumb = await getFile(t, a.photos[0]!.thumbUrl!);
    expect(thumb.statusCode).toBe(200);
    const meta = await readImageMeta(thumb.rawPayload);
    expect(Math.max(meta.width, meta.height)).toBe(480);
  });

  it('edi_image(data URL) 에만 있는 구 방식 이미지는 디코드해서 전달', async () => {
    const c = await legacyDetail('2026-08', '대전연세정형외과');
    const full = await getFile(t, c.photos[0]!.imageUrl!);
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('image/jpeg');
    const meta = await readImageMeta(full.rawPayload);
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 600, 800]);
    const thumb = await getFile(t, c.photos[0]!.thumbUrl!);
    expect(thumb.statusCode).toBe(200);
  });

  it('관리자가 담당자를 바꿔도(edi.user_id 변경) 앱으로 제출한 사용자는 자기 사진을 볼 수 있다', async () => {
    const p = submission.photos[2]!;
    await t.db.query("UPDATE public.edi SET user_id = 'ckp_md5' WHERE idx = $1", [p.ediIdx]);
    try {
      expect((await getFile(t, p.imageUrl!)).statusCode).toBe(200);
    } finally {
      await t.db.query("UPDATE public.edi SET user_id = 'ckp_demo' WHERE idx = $1", [p.ediIdx]);
    }
  });

  it('edi 행이 삭제되면 404', async () => {
    const a = await legacyDetail('2026-09', '미소가정의학과의원');
    const url = a.photos[0]!.imageUrl!;
    expect((await getFile(t, url)).statusCode).toBe(200);
    await t.db.query('DELETE FROM public.edi WHERE idx = $1', [a.photos[0]!.ediIdx]);
    expectNotFound(await getFile(t, url));
  });
});

describe('이전 방식 https 이미지 (LEGACY_IMAGE_URL_PREFIXES)', () => {
  async function withAwsUrl<T>(url: string, fn: (idx: number) => Promise<T>): Promise<T> {
    const idx = submission.photos[0]!.ediIdx!;
    const { rows } = await t.db.query<{ aws_url: string }>('SELECT aws_url FROM public.edi WHERE idx = $1', [idx]);
    await t.db.query('UPDATE public.edi SET aws_url = $2 WHERE idx = $1', [idx, url]);
    try {
      return await fn(idx);
    } finally {
      await t.db.query('UPDATE public.edi SET aws_url = $2 WHERE idx = $1', [idx, rows[0]!.aws_url]);
    }
  }

  it('허용 접두어로 시작하는 https 는 서버가 가져와 전달 (리다이렉트 불허·시간 제한)', async () => {
    const img = await jpeg(640, 480);
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(img), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    await withAwsUrl(`${LEGACY_PREFIX}2025/10/a.jpg`, async (idx) => {
      const res = await fetchPath(signEdi(idx));
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(img)).toBe(true);
      const thumb = await fetchPath(signEdi(idx, 'thumb'));
      expect(thumb.statusCode).toBe(200);
    });
    expect(fetchMock).toHaveBeenCalled();
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(`${LEGACY_PREFIX}2025/10/a.jpg`);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('허용되지 않은 주소(다른 호스트·호스트 속이기·http·접두어 밖 경로)는 가져오지 않고 404', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(await jpeg()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    for (const url of [
      'https://evil.example.com/edi/a.jpg',
      'https://legacy-img.example.com.evil.com/edi/a.jpg',
      'https://legacy-img.example.com@evil.com/edi/a.jpg',
      'http://legacy-img.example.com/edi/a.jpg',
      'https://legacy-img.example.com/private/a.jpg',
      'https://legacy-img.example.com/edi-other/a.jpg',
    ]) {
      await withAwsUrl(url, async (idx) => {
        expectNotFound(await fetchPath(signEdi(idx)));
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('10MB 초과(선언·실제), 시간 초과, 이미지가 아닌 응답, 오류 응답 → 404', async () => {
    const big = new Uint8Array(LEGACY_FETCH_MAX_BYTES + 1);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    const cases: Array<() => Promise<Response>> = [
      async () => new Response(big, { status: 200 }),
      async () => new Response(new Uint8Array(await jpeg()), { status: 200, headers: { 'content-length': String(20 * 1024 * 1024) } }),
      async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
      async () => new Response('<html>not an image</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      async () => new Response('', { status: 403 }),
    ];
    for (const make of cases) {
      vi.stubGlobal('fetch', vi.fn(make));
      await withAwsUrl(`${LEGACY_PREFIX}x.jpg`, async (idx) => {
        expectNotFound(await fetchPath(signEdi(idx)));
      });
    }
  });

  it('접두어 비교 규칙 (단위)', () => {
    const prefixes = [LEGACY_PREFIX, 'https://edi-img.s3.ap-northeast-2.amazonaws.com/'];
    expect(isAllowedLegacyUrl(`${LEGACY_PREFIX}a/b.jpg`, prefixes)).toBe(true);
    expect(isAllowedLegacyUrl('https://edi-img.s3.ap-northeast-2.amazonaws.com/uploads/x.jpg', prefixes)).toBe(true);
    expect(isAllowedLegacyUrl('https://edi-img.s3.ap-northeast-2.amazonaws.com.evil.io/x.jpg', prefixes)).toBe(false);
    expect(isAllowedLegacyUrl('https://legacy-img.example.com/edi/../secret.jpg', prefixes)).toBe(false);
    expect(isAllowedLegacyUrl('not a url', prefixes)).toBe(false);
    expect(isAllowedLegacyUrl(`${LEGACY_PREFIX}a.jpg`, [])).toBe(false);
  });

  it('edi_image 디코드 (단위): data URL, 원시 JPEG, 그 외는 null', async () => {
    const img = await jpeg(500, 500);
    expect(decodeEdiImage(Buffer.from(`data:image/jpeg;base64,${img.toString('base64')}`, 'ascii'))?.equals(img)).toBe(true);
    expect(decodeEdiImage(img)?.equals(img)).toBe(true);
    expect(decodeEdiImage(Buffer.from('data:image/jpeg,not-base64', 'ascii'))).toBeNull();
    expect(decodeEdiImage(Buffer.from('hello world', 'utf8'))).toBeNull();
  });
});

describe('토큰 검증·소유 확인', () => {
  it('다른 사용자 이름으로 서명된 토큰(내 사진이 아님) → 404', async () => {
    const p = submission.photos[0]!;
    expectNotFound(await fetchPath(signEdi(p.ediIdx!, 'full', 'ckp_md5')));
    expectNotFound(await fetchPath(`/v1/files/${t.app.deps.tokens.signFileToken({ k: 'u', id: uploadIds[0]!, v: 'thumb', u: 'ckp_md5' })}`));
    // 다른 사용자의 이전 방식 사진
    const { rows } = await t.db.query<{ idx: number }>("SELECT idx FROM public.edi WHERE user_id = 'ckp_md5' LIMIT 1");
    expectNotFound(await fetchPath(signEdi(rows[0]!.idx)));
    expect((await fetchPath(signEdi(rows[0]!.idx, 'full', 'ckp_md5'))).statusCode).toBe(200);
  });

  it('만료된 토큰 → 404 (1시간 후), 시계를 되돌리면 다시 열림', async () => {
    const url = submission.photos[0]!.thumbUrl!;
    t.clock.advance(3601 * 1000);
    try {
      expectNotFound(await getFile(t, url));
    } finally {
      t.clock.set(NOW);
    }
    expect((await getFile(t, url)).statusCode).toBe(200);
  });

  it('위조·변조·형식 오류 토큰 → 404', async () => {
    const path = pathOf(submission.photos[0]!.imageUrl!);
    const token = path.split('/').pop()!;
    const [body, sig] = token.split('.') as [string, string];
    const flipped = `${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
    const forgedBody = Buffer.from(JSON.stringify({ k: 'e', id: 1, v: 'full', u: 'ckp_demo', exp: 4102444800 })).toString('base64url');
    for (const p of [
      `/v1/files/${body}.${flipped}`,
      `/v1/files/${forgedBody}.${sig}`,
      `/v1/files/${body}`,
      '/v1/files/not-a-token',
      `/v1/files/${token}/extra`,
      '/v1/files/',
    ]) {
      expectNotFound(await fetchPath(p));
    }
  });

  it('토큰 사용자가 차단되면 404', async () => {
    const url = submission.photos[0]!.thumbUrl!;
    await t.db.query("UPDATE public.sys_app_usr_mng SET apr_yn = 'S' WHERE usr_id = 'ckp_demo'");
    t.app.userStatusCache.invalidate('ckp_demo');
    try {
      expectNotFound(await getFile(t, url));
    } finally {
      await t.db.query("UPDATE public.sys_app_usr_mng SET apr_yn = 'Y' WHERE usr_id = 'ckp_demo'");
      t.app.userStatusCache.invalidate('ckp_demo');
    }
    expect((await getFile(t, url)).statusCode).toBe(200);
  });
});

describe('PUBLIC_BASE_URL 설정', () => {
  let t2: TestContext;
  beforeAll(async () => {
    t2 = await createTestApp({ now: NOW, env: { PUBLIC_BASE_URL: 'https://api.ckp.example.com/' } });
  });
  afterAll(async () => {
    await t2?.close();
  });

  it('서명 URL 이 PUBLIC_BASE_URL 기준 절대 주소로 만들어진다', async () => {
    const up = await uploadOk(t2, 'ckp_demo');
    expect(up.thumbUrl).toMatch(/^https:\/\/api\.ckp\.example\.com\/v1\/files\/[\w-]+\.[\w-]+$/);
    expect((await getFile(t2, up.thumbUrl)).statusCode).toBe(200);
  });
});
