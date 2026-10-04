import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcryptjs from 'bcryptjs';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConfigError, getConfigWarnings, loadConfig, serverStartProblems } from '../src/config.js';
import { ConcurrencyLimiter } from '../src/lib/attempts.js';
import { clientIpKey } from '../src/lib/client-ip.js';
import { checkBizNo, formatBizNo, isValidBizNoChecksum, normalizeBizNo, withBizNoCheckDigit } from '../src/lib/bizno.js';
import { createTestClock } from '../src/lib/clock.js';
import { AppError, toAppError } from '../src/lib/errors.js';
import {
  HEIC_MESSAGE,
  makeThumbnail,
  makeThumbnailLenient,
  normalizeImage,
  processPhoto,
  readImageMeta,
  sniffImageType,
  stripJpegMetadata,
} from '../src/lib/image.js';
import {
  currentYmKst,
  ediMonthLabelForYm,
  ediMonthOptions,
  ediTargetYmFromLabel,
  isValidYm,
  isValidYmd,
  nowKst,
  todayKst,
  ymAdd,
  ymDateRange,
  ymDiff,
  ymDisplay,
} from '../src/lib/kst.js';
import {
  BCRYPT_MAX_CONCURRENCY,
  BCRYPT_MAX_QUEUE,
  PasswordBusyError,
  detectScheme,
  dummyVerify,
  hashPassword,
  md5Hex,
  verifyPassword,
} from '../src/lib/password.js';
import { OMITTED_IMAGE_TEXT, sanitizeNoticeHtml } from '../src/lib/sanitize.js';
import { createTokenService } from '../src/lib/tokens.js';
import { escapeLike, optionalText, parseInput } from '../src/lib/validation.js';
import { S3Storage, ediObjectKeys } from '../src/storage/index.js';
import { LocalStorage } from '../src/storage/local.js';

const DEV_JWT = 'dev-only-jwt-secret-7f3a9c2e5b8d41f6a0c9e2b5d8f1a4c7';

// ─────────────────────────── KST ───────────────────────────

describe('lib/kst', () => {
  it('UTC 15:30 은 KST 다음 날 00:30 (연도 경계)', () => {
    const at = new Date('2025-12-31T15:30:00Z'); // = 2026-01-01 00:30 KST
    expect(todayKst(at)).toBe('2026-01-01');
    expect(nowKst(at)).toBe('2026-01-01 00:30:00');
    expect(currentYmKst(at)).toBe('2026-01');
  });

  it('2026-01-01 00:30 KST 의 EDI 월 옵션: 당월=2025-12, 전월=2025-11, 전전월=2025-10', () => {
    const r = ediMonthOptions(new Date('2025-12-31T15:30:00Z'));
    expect(r.defaultLabel).toBe('당월');
    expect(r.options).toEqual([
      { label: '당월', ym: '2025-12', display: '당월 (2025년 12월)' },
      { label: '전월', ym: '2025-11', display: '전월 (2025년 11월)' },
      { label: '전전월', ym: '2025-10', display: '전전월 (2025년 10월)' },
    ]);
  });

  it('월 경계: 1월 31일 23:59:59 KST 와 2월 1일 00:00 KST', () => {
    expect(ediMonthOptions(new Date('2026-01-31T14:59:59Z')).options[0]?.ym).toBe('2025-12');
    expect(ediMonthOptions(new Date('2026-01-31T15:00:00Z')).options[0]?.ym).toBe('2026-01');
    const march = ediMonthOptions(new Date('2026-02-28T15:00:00Z')).options.map((o) => o.ym); // 3월 1일 KST
    expect(march).toEqual(['2026-02', '2026-01', '2025-12']);
  });

  it('서버 TZ 설정과 무관하게 같은 결과', () => {
    const prev = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(nowKst(new Date('2026-09-24T15:00:00Z'))).toBe('2026-09-25 00:00:00');
      process.env.TZ = 'UTC';
      expect(nowKst(new Date('2026-09-24T15:00:00Z'))).toBe('2026-09-25 00:00:00');
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  it('연월 계산', () => {
    expect(ymAdd('2026-01', -1)).toBe('2025-12');
    expect(ymAdd('2025-11', 3)).toBe('2026-02');
    expect(ymAdd('2026-03', -27)).toBe('2023-12');
    expect(ymDiff('2026-01', '2025-11')).toBe(2);
    expect(ymDisplay('2026-08')).toBe('2026년 8월');
    expect(ymDateRange('2026-12')).toEqual({ from: '2026-12-01', toExclusive: '2027-01-01' });
    expect(isValidYm('2026-13')).toBe(false);
    expect(isValidYm('2026-09')).toBe(true);
    expect(isValidYm('0000-01')).toBe(false); // PostgreSQL 에 0년이 없어 DB 오류(500)가 나던 값
    expect(isValidYm('0001-01')).toBe(true);
    expect(isValidYm(202609)).toBe(false);
    expect(isValidYmd('2026-02-29')).toBe(false);
    expect(isValidYmd('2028-02-29')).toBe(true);
    expect(() => ymAdd('2026/01', 1)).toThrow(RangeError);
  });

  it('대상 월 ↔ 라벨', () => {
    const at = new Date('2026-09-25T01:00:00Z');
    expect(ediMonthLabelForYm('2026-08', at)).toBe('당월');
    expect(ediMonthLabelForYm('2026-06', at)).toBe('전전월');
    expect(ediMonthLabelForYm('2026-09', at)).toBeNull();
    expect(ediTargetYmFromLabel('전월', '2026-01-15')).toBe('2025-11');
    expect(ediTargetYmFromLabel(null, '2026-01-15')).toBeNull();
    expect(ediTargetYmFromLabel('기타', '2026-01-15')).toBeNull();
  });
});

// ─────────────────────────── 사업자번호 ───────────────────────────

describe('lib/bizno', () => {
  const valid = withBizNoCheckDigit('123456789'); // 1234567891
  it('검증번호 계산·확인', () => {
    expect(valid).toBe('1234567891');
    expect(isValidBizNoChecksum(valid)).toBe(true);
    expect(isValidBizNoChecksum('1234567890')).toBe(false);
    expect(isValidBizNoChecksum('123456789')).toBe(false);
    for (const first9 of ['314812345', '305271111', '211876543', '000000000']) {
      expect(isValidBizNoChecksum(withBizNoCheckDigit(first9))).toBe(true);
    }
  });

  it('입력 검증 메시지', () => {
    expect(checkBizNo('123-45-67891')).toEqual({ ok: true, digits: '1234567891', formatted: '123-45-67891' });
    expect(checkBizNo('123-45-67890')).toMatchObject({ ok: false, reason: 'checksum', message: '사업자등록번호가 유효하지 않습니다. 번호를 다시 확인해 주세요.' });
    expect(checkBizNo('123-45-678')).toMatchObject({ ok: false, reason: 'length', message: '사업자등록번호 10자리를 정확히 입력해 주세요.' });
    expect(checkBizNo('12a4567891')).toMatchObject({ ok: false, reason: 'chars' });
    expect(checkBizNo('  ')).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('정규화·표시 형식', () => {
    expect(normalizeBizNo(' 123-45 67891 ')).toBe('1234567891');
    expect(formatBizNo('1234567891')).toBe('123-45-67891');
    expect(formatBizNo('사업자번호 미확인')).toBe('사업자번호 미확인');
    expect(formatBizNo('')).toBeNull();
    expect(formatBizNo(null)).toBeNull();
  });
});

// ─────────────────────────── 비밀번호 ───────────────────────────

describe('lib/password', () => {
  it('bcrypt / MD5(UTF-8, CP949) / 형식 불명', async () => {
    const bcrypt = await hashPassword('pass1234', 4);
    expect(detectScheme(bcrypt)).toBe('bcrypt');
    expect(await verifyPassword('pass1234', bcrypt)).toEqual({ ok: true, scheme: 'bcrypt' });
    expect((await verifyPassword('pass12345', bcrypt)).ok).toBe(false);

    expect(md5Hex('demo1234')).toBe('6e9bece1914809fb8493146417e722f6');
    expect(await verifyPassword(' demo1234 ', md5Hex('demo1234'))).toEqual({ ok: true, scheme: 'md5', encoding: 'utf8' });

    const cp949 = md5Hex('한글암호', 'cp949');
    expect(cp949).not.toBe(md5Hex('한글암호', 'utf8'));
    expect(await verifyPassword('한글암호', cp949)).toEqual({ ok: true, scheme: 'md5', encoding: 'cp949' });

    expect(await verifyPassword('demo1234', 'demo1234')).toEqual({ ok: false, scheme: 'unknown' });
    expect(await verifyPassword('x', null)).toEqual({ ok: false, scheme: 'unknown' });
  });

  describe('응답 시간 · 동시 실행 제한', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('MD5 계정의 틀린 비밀번호도 없는 계정처럼 bcrypt 비교를 1회 한다 (계정 존재 노출 방지)', async () => {
      await dummyVerify(); // 더미 해시 준비(최초 1회 bcrypt.hash)
      const compare = vi.spyOn(bcryptjs, 'compare');
      expect(await verifyPassword('wrong-pass', md5Hex('demo1234'))).toEqual({ ok: false, scheme: 'md5' });
      expect(compare).toHaveBeenCalledTimes(1);
      await dummyVerify();
      expect(compare).toHaveBeenCalledTimes(2);
      compare.mockClear();
      expect((await verifyPassword('demo1234', md5Hex('demo1234'))).ok).toBe(true); // 성공은 그대로 빠르게
      expect(compare).not.toHaveBeenCalled();
    });

    it(`bcrypt 는 동시에 ${BCRYPT_MAX_CONCURRENCY}개까지만, 대기열(${BCRYPT_MAX_QUEUE})이 가득 차면 PasswordBusyError`, async () => {
      const stored = await hashPassword('pass1234', 4);
      let inFlight = 0;
      let peak = 0;
      vi.spyOn(bcryptjs, 'compare').mockImplementation((async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return false;
      }) as never);
      const extra = 3;
      const results = await Promise.all(
        Array.from({ length: BCRYPT_MAX_CONCURRENCY + BCRYPT_MAX_QUEUE + extra }, () =>
          verifyPassword('x', stored).then(
            (r) => r.ok,
            (e: unknown) => e,
          ),
        ),
      );
      expect(peak).toBe(BCRYPT_MAX_CONCURRENCY);
      expect(results.filter((r) => r instanceof PasswordBusyError)).toHaveLength(extra);
      expect(results.filter((r) => r === false)).toHaveLength(BCRYPT_MAX_CONCURRENCY + BCRYPT_MAX_QUEUE);
      // 대기열이 비면 다시 받는다
      expect((await verifyPassword('x', stored)).ok).toBe(false);
    });

    it('ConcurrencyLimiter: 자리 넘기기·중복 해제 무시', async () => {
      const lim = new ConcurrencyLimiter(1, 1);
      const a = lim.tryAcquire()!;
      const b = lim.tryAcquire()!;
      expect(lim.tryAcquire()).toBeNull();
      expect([lim.running, lim.queued]).toEqual([1, 1]);
      a.done();
      a.done(); // 두 번 호출해도 한 번만 반영
      await b.ready;
      expect([lim.running, lim.queued]).toEqual([1, 0]);
      b.done();
      expect(lim.running).toBe(0);
      expect(lim.tryAcquire()).not.toBeNull();
    });
  });
});

describe('lib/client-ip', () => {
  it('IPv4 는 그대로, IPv6 는 /64 대역, IPv4-mapped 는 IPv4 로', () => {
    expect(clientIpKey('203.0.113.9')).toBe('203.0.113.9');
    expect(clientIpKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(clientIpKey('2001:db8:1:2::1'));
    expect(clientIpKey('2001:db8:1:2::1')).not.toBe(clientIpKey('2001:db8:1:3::1'));
    expect(clientIpKey('::ffff:10.0.0.7')).toBe('10.0.0.7');
    expect(clientIpKey(undefined)).toBe('unknown');
  });
});

// ─────────────────────────── 토큰 ───────────────────────────

describe('lib/tokens', () => {
  const clock = createTestClock('2026-09-25T00:00:00Z');
  const tokens = createTokenService({
    jwtSecret: 'test-secret-test-secret-test-secret-00',
    fileTokenSecret: 'file-secret-file-secret-file-secret-00',
    accessTtlMin: 30,
    refreshTtlDays: 14,
    clock,
  });

  it('access/refresh 는 typ 로 구분된다', async () => {
    const a = await tokens.issueAccessToken('ckp_demo');
    const r = await tokens.issueRefreshToken('ckp_demo');
    expect((await tokens.verifyAccessToken(a.token)).usrId).toBe('ckp_demo');
    expect((await tokens.verifyRefreshToken(r.token)).jti).toBe(r.jti);
    await expect(tokens.verifyAccessToken(r.token)).rejects.toMatchObject({ reason: 'invalid' });
    await expect(tokens.verifyRefreshToken(a.token)).rejects.toMatchObject({ reason: 'invalid' });
    expect(a.expiresAt.toISOString()).toBe('2026-09-25T00:30:00.000Z');
    // DB 기록 방식(st=1) 여부
    expect((await tokens.verifyRefreshToken(r.token)).stored).toBe(false);
    const stored = await tokens.issueRefreshToken('ckp_demo', { stored: true });
    expect(await tokens.verifyRefreshToken(stored.token)).toMatchObject({ usrId: 'ckp_demo', jti: stored.jti, stored: true });
  });

  it('파일 토큰: 서명 확인·위조·만료', () => {
    const token = tokens.signFileToken({ k: 'u', id: 'b1c2', v: 'thumb', u: 'ckp_demo' });
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(tokens.verifyFileToken(token)).toMatchObject({ k: 'u', id: 'b1c2', v: 'thumb', u: 'ckp_demo' });
    const [body, sig] = token.split('.') as [string, string];
    const forgedBody = Buffer.from(JSON.stringify({ k: 'u', id: 'other', v: 'full', u: 'ckp_demo', exp: 9999999999 })).toString('base64url');
    expect(tokens.verifyFileToken(`${forgedBody}.${sig}`)).toBeNull();
    expect(tokens.verifyFileToken(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(tokens.verifyFileToken('garbage')).toBeNull();
    clock.advance(3601 * 1000);
    expect(tokens.verifyFileToken(token)).toBeNull();
  });
});

// ─────────────────────────── 공지 HTML 정화 ───────────────────────────

describe('lib/sanitize', () => {
  const clean = sanitizeNoticeHtml;

  it('script/style/이벤트 속성/javascript: 링크 제거', () => {
    const out = clean(
      '<p onclick="alert(1)">본문</p><script>alert(1)</script><style>p{}</style>' +
        '<img src=x onerror=alert(1)><a href="javascript:alert(1)">a</a><a href="JaVaScRiPt:alert(2)">b</a>' +
        '<a href="java&#x09;script:alert(3)">c</a><svg onload=alert(4)><title>t</title></svg><div onmouseover="x">d</div>',
    );
    expect(out).not.toMatch(/script|onerror|onclick|onload|onmouseover|javascript|<svg|<style|alert/i);
    expect(out).toContain('<p>본문</p>');
  });

  it('링크는 https/mailto/tel 만, rel·target 강제', () => {
    const out = clean('<a href="https://ok.example.com/a?b=1" target="_self">ok</a><a href="http://insecure.example.com">h</a><a href="mailto:a@b.com">m</a><a href="tel:010-1234-5678">t</a><a href="/relative">r</a><a href="//evil.example.com">p</a>');
    expect(out).toContain('<a href="https://ok.example.com/a?b=1" target="_blank" rel="noopener noreferrer nofollow">ok</a>');
    expect(out).toContain('<a href="mailto:a@b.com"');
    expect(out).toContain('<a href="tel:010-1234-5678"');
    expect(out).not.toMatch(/insecure|relative|evil/);
  });

  it('base64 data: 이미지는 유지, 다른 data: 형식은 제거', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    expect(clean(`<p><img src="data:image/png;base64,${png}" alt="예시" width="100" height="50%"></p>`)).toBe(
      `<p><img src="data:image/png;base64,${png}" alt="예시" width="100" height="50%" /></p>`,
    );
    expect(clean('<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">')).toBe('');
    expect(clean('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">')).toBe('');
    expect(clean('<img src="https://img.example.com/a.png" width="abc">')).toBe('<img src="https://img.example.com/a.png" />');
  });

  it('5MB 초과 data: 이미지는 [이미지 생략] 으로 대체하고 뒤 내용은 유지', () => {
    const big = 'A'.repeat(Math.ceil((5 * 1024 * 1024 + 10) / 3) * 4);
    const out = clean(`<p>앞</p><img src="data:image/jpeg;base64,${big}"><p>뒤</p>`);
    expect(out).toBe(`<p>앞</p><span>${OMITTED_IMAGE_TEXT}</span><p>뒤</p>`);
  });

  it('iframe 은 https 일 때만 "동영상 보기" 링크로', () => {
    expect(clean('<iframe class="ql-video" frameborder="0" allowfullscreen="true" src="https://www.youtube.com/embed/abc"></iframe>')).toBe(
      '<p><a href="https://www.youtube.com/embed/abc" target="_blank" rel="noopener noreferrer nofollow">동영상 보기</a></p>',
    );
    expect(clean('<iframe src="javascript:alert(1)"></iframe><iframe src="http://x.example.com"></iframe>')).toBe('');
  });

  it('Quill 정렬 class → text-align style, 그 외 class/style 제거', () => {
    expect(clean('<p class="ql-align-center">가</p><h2 class="ql-align-right ql-indent-1">나</h2><li class="ql-align-justify">다</li>')).toBe(
      '<p style="text-align:center">가</p><h2 style="text-align:right">나</h2><li style="text-align:justify">다</li>',
    );
    expect(clean('<p style="color:red;background:url(javascript:alert(1))" class="ql-indent-2">라</p><span class="ql-size-large" style="font-size:40px">마</span>')).toBe(
      '<p>라</p><span>마</span>',
    );
  });

  it('빈 값', () => {
    expect(clean(null)).toBe('');
    expect(clean('')).toBe('');
  });
});

// ─────────────────────────── 이미지 ───────────────────────────

describe('lib/image', () => {
  const solid = (w: number, h: number, bg = '#3366cc') => sharp({ create: { width: w, height: h, channels: 3, background: bg } });

  it('매직 바이트 판별', async () => {
    expect(sniffImageType(await solid(20, 20).jpeg().toBuffer())).toBe('jpeg');
    expect(sniffImageType(await solid(20, 20).png().toBuffer())).toBe('png');
    expect(sniffImageType(await solid(20, 20).webp().toBuffer())).toBe('webp');
    expect(sniffImageType(await solid(20, 20).gif().toBuffer())).toBe('gif');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(16)]);
    expect(sniffImageType(heic)).toBe('heic');
    expect(sniffImageType(Buffer.from('hello world, not an image'))).toBeNull();
  });

  it('EXIF 회전(orientation 6) JPEG 은 회전 적용 후 재인코딩, 메타데이터 없음', async () => {
    const rotated = await solid(800, 400).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const meta = await readImageMeta(rotated);
    expect(meta).toMatchObject({ format: 'jpeg', width: 800, height: 400, displayWidth: 400, displayHeight: 800, orientation: 6 });
    const out = await normalizeImage(rotated, meta);
    expect(out.strategy).toBe('reencode');
    expect([out.width, out.height]).toEqual([400, 800]);
    const outMeta = await sharp(out.buffer).metadata();
    expect(outMeta.format).toBe('jpeg');
    expect(outMeta.orientation).toBeUndefined();
    expect(outMeta.exif).toBeUndefined();
  });

  it('방향 정상 JPEG 은 EXIF 만 무손실 제거 (픽셀 동일, ICC 유지)', async () => {
    const src = await solid(900, 600, '#cc6633')
      .withExif({ IFD0: { Artist: 'Tester', Copyright: 'CKP GPS 포함 가정' } })
      .withIccProfile('srgb')
      .jpeg({ quality: 90 })
      .toBuffer();
    expect((await sharp(src).metadata()).exif).toBeDefined();
    const out = await normalizeImage(src);
    expect(out.strategy).toBe('lossless-strip');
    expect(out.bytes).toBeLessThan(src.length);
    const m = await sharp(out.buffer).metadata();
    expect(m.exif).toBeUndefined();
    expect(m.icc).toBeDefined();
    expect((await sharp(out.buffer).raw().toBuffer()).equals(await sharp(src).raw().toBuffer())).toBe(true);
    expect(out.buffer.includes(Buffer.from('Tester'))).toBe(false);
  });

  it('프로그레시브 JPEG + 꼬리 데이터도 안전하게 제거', async () => {
    const prog = await solid(300, 200).withExif({ IFD0: { Artist: 'X' } }).jpeg({ progressive: true }).toBuffer();
    const stripped = stripJpegMetadata(Buffer.concat([prog, Buffer.from('TRAILING-DATA')]));
    expect(stripped).not.toBeNull();
    expect(stripped!.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect((await sharp(stripped!).raw().toBuffer()).equals(await sharp(prog).raw().toBuffer())).toBe(true);
    expect(stripJpegMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff]))).toBeNull();
  });

  it('긴 변 3200 초과는 축소, PNG(투명)·WEBP 는 JPEG 로 변환', async () => {
    const big = await normalizeImage(await solid(4000, 3000).jpeg().toBuffer());
    expect([big.strategy, big.width, big.height]).toEqual(['reencode', 3200, 2400]);

    const png = await sharp({ create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const fromPng = await normalizeImage(png);
    expect(fromPng.contentType).toBe('image/jpeg');
    expect(sniffImageType(fromPng.buffer)).toBe('jpeg');
    const { data } = await sharp(fromPng.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(245); // 투명 → 흰 배경

    const fromWebp = await normalizeImage(await solid(640, 480).webp().toBuffer());
    expect(sniffImageType(fromWebp.buffer)).toBe('jpeg');
  });

  it('느슨한 썸네일: 끝이 잘린 JPEG 도 480 썸네일로 (엄격한 makeThumbnail 은 거부)', async () => {
    const full = await solid(2000, 1500, '#88aacc').jpeg({ quality: 85 }).toBuffer();
    const cut = full.subarray(0, Math.floor(full.length * 0.6));
    await expect(makeThumbnail(cut)).rejects.toThrow();
    const t = await makeThumbnailLenient(cut);
    expect([t.width, t.height]).toEqual([480, 360]);
    expect(sniffImageType(t.buffer)).toBe('jpeg');
    const garbage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);
    await expect(makeThumbnailLenient(garbage)).rejects.toThrow();
  });

  it('썸네일은 긴 변 480 (회전 반영)', async () => {
    const t1 = await makeThumbnail(await solid(1200, 800).jpeg().toBuffer());
    expect([t1.width, t1.height]).toEqual([480, 320]);
    const t2 = await makeThumbnail(await solid(800, 400).withMetadata({ orientation: 6 }).jpeg().toBuffer());
    expect([t2.width, t2.height]).toEqual([240, 480]);
  });

  it('processPhoto: 오류는 한국어 AppError (415/422)', async () => {
    const ok = await processPhoto(await solid(1000, 700).jpeg().toBuffer(), { minLongSide: 400 });
    expect(ok.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.thumb.width).toBe(480);
    expect(ok.image.contentType).toBe('image/jpeg');

    await expect(processPhoto(await solid(300, 200).jpeg().toBuffer(), { minLongSide: 400 })).rejects.toMatchObject({
      code: 'IMAGE_TOO_SMALL',
      statusCode: 422,
    });
    await expect(processPhoto(await solid(600, 600).gif().toBuffer(), { minLongSide: 400 })).rejects.toMatchObject({
      code: 'UNSUPPORTED_FILE_TYPE',
      statusCode: 415,
    });
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(40)]);
    await expect(processPhoto(heic, { minLongSide: 400 })).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE', message: HEIC_MESSAGE });
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    await expect(processPhoto(broken, { minLongSide: 400 })).rejects.toMatchObject({ code: 'IMAGE_DECODE_FAILED', statusCode: 422 });
  });
});

// ─────────────────────────── 저장소 ───────────────────────────

describe('storage', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ckp-storage-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('로컬: 저장·읽기·삭제·URL 왕복', async () => {
    const s = new LocalStorage(dir);
    const { objectKey, thumbKey } = ediObjectKeys('uploads/users/ckp', '202609', 'abc-123');
    expect(objectKey).toBe('uploads/users/ckp/edi/202609/abc-123.jpg');
    expect(thumbKey).toBe('uploads/users/ckp/edi/202609/abc-123_thumb.jpg');
    await s.put(objectKey, Buffer.from('hello'), 'image/jpeg');
    expect((await s.getBuffer(objectKey))?.toString()).toBe('hello');
    expect(await readFile(path.join(dir, 'uploads', 'users', 'ckp', 'edi', '202609', 'abc-123.jpg'), 'utf8')).toBe('hello');
    const stream = await s.getStream(objectKey);
    expect(stream).not.toBeNull();
    stream?.destroy();
    expect(s.publicUrl(objectKey)).toBe(`local:${objectKey}`);
    expect(s.keyFromUrl(`local:${objectKey}`)).toBe(objectKey);
    expect(s.keyFromUrl('https://edi-img.s3.ap-northeast-2.amazonaws.com/x.jpg')).toBeNull();
    await s.delete(objectKey);
    expect(await s.getBuffer(objectKey)).toBeNull();
    await s.delete(objectKey); // 없어도 오류 아님
  });

  it('로컬: 경로 이탈 키 거부', async () => {
    const s = new LocalStorage(dir);
    for (const bad of ['../x.jpg', 'a/../../b.jpg', '/abs.jpg', 'a\\b.jpg', 'a//b.jpg', 'C:/x.jpg', '', 'a/./b']) {
      await expect(s.put(bad, Buffer.from('x'), 'image/jpeg')).rejects.toThrow();
    }
    expect(s.keyFromUrl('local:../../etc/passwd')).toBeNull();
  });

  it('S3: 공개 URL 규칙 (네트워크 없음)', () => {
    const s3 = new S3Storage({ bucket: 'edi-img', region: 'ap-northeast-2' });
    const url = s3.publicUrl('uploads/users/ckp/edi/202609/u1.jpg');
    expect(url).toBe('https://edi-img.s3.ap-northeast-2.amazonaws.com/uploads/users/ckp/edi/202609/u1.jpg');
    expect(url.length).toBeLessThanOrEqual(200);
    expect(s3.keyFromUrl(url)).toBe('uploads/users/ckp/edi/202609/u1.jpg');
    expect(s3.keyFromUrl(`${url}?X-Amz-Signature=abc`)).toBeNull();
    const cdn = new S3Storage({ bucket: 'b', region: 'ap-northeast-2', publicBaseUrl: 'https://cdn.example.com/' });
    expect(cdn.publicUrl('a/b.jpg')).toBe('https://cdn.example.com/a/b.jpg');
  });
});

// ─────────────────────────── 설정 · 오류 · 검증 ───────────────────────────

describe('config', () => {
  it('개발 기본값', () => {
    const c = loadConfig({ NODE_ENV: 'development', DEV_DB: 'pglite' });
    expect(c.devDb.enabled).toBe(true);
    expect(c.port).toBe(4000);
    expect(c.cors.origins).toEqual(['http://localhost:8081']);
    expect(c.storage).toMatchObject({ driver: 'local', keyPrefix: 'uploads/users/ckp' });
    expect(c.features).toEqual({ clientApprovalRequiredForEdi: true, medicineFeeVisible: true });
    expect(c.auth.cookieSecure).toBe(false);
    expect(c.auth.usingDevSecrets).toBe(true);
  });

  it('운영 보호 규칙', () => {
    const expectProblems = (env: Record<string, string>, pattern: RegExp) => {
      try {
        loadConfig(env);
        throw new Error('ConfigError 가 발생해야 합니다');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as ConfigError).problems.join('\n')).toMatch(pattern);
      }
    };
    const prodBase = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@db.example.com:5432/cso_ckp',
      JWT_SECRET: 'x'.repeat(40),
      FILE_TOKEN_SECRET: 'y'.repeat(40),
      CORS_ORIGINS: 'https://app.example.com',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'edi-img',
    };
    expect(loadConfig(prodBase).isProduction).toBe(true);
    expect(loadConfig(prodBase).auth.cookieSecure).toBe(true);
    expect(loadConfig(prodBase).database.ssl).toBe('require');
    expectProblems({ ...prodBase, DATABASE_URL: '' }, /DATABASE_URL/);
    expectProblems({ ...prodBase, JWT_SECRET: '' }, /JWT_SECRET/);
    expectProblems({ ...prodBase, FILE_TOKEN_SECRET: 'short' }, /FILE_TOKEN_SECRET 은 32자/);
    expectProblems({ ...prodBase, JWT_SECRET: 'dev-only-jwt-secret-7f3a9c2e5b8d41f6a0c9e2b5d8f1a4c7' }, /개발용 비밀키/);
    expectProblems({ ...prodBase, DEV_DB: 'pglite' }, /DEV_DB/);
    expectProblems({ ...prodBase, CORS_ORIGINS: '*' }, /'\*'/);
    expectProblems({ ...prodBase, S3_BUCKET: '' }, /S3_BUCKET/);
    expectProblems({ ...prodBase, LEGACY_IMAGE_URL_PREFIXES: 'http://insecure.example.com/' }, /https/);
    expectProblems({ NODE_ENV: 'development', DEV_DB: 'off' }, /DEV_DB=pglite/);
    // 개발에서 DATABASE_URL·DEV_DB 가 모두 없으면 내장 DB 기본 사용
    expect(loadConfig({ NODE_ENV: 'development' }).devDb.enabled).toBe(true);
    expect(loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgres://localhost/x' }).devDb.enabled).toBe(false);

    // 쿠키 Secure 끄기 금지, DB 평문 연결 경고
    expectProblems({ ...prodBase, COOKIE_SECURE: 'false' }, /COOKIE_SECURE=false/);
    expect(loadConfig({ ...prodBase, COOKIE_SECURE: '' }).auth.cookieSecure).toBe(true);
    const plain = loadConfig({ ...prodBase, DATABASE_SSL: 'disable' });
    expect(plain.database.ssl).toBe('disable');
    expect(getConfigWarnings(plain).join('\n')).toMatch(/DB 연결이 암호화되지 않습니다/);
    expect(getConfigWarnings(loadConfig(prodBase)).join('\n')).not.toMatch(/암호화/);
  });

  it('DATABASE_URL 의 sslmode 를 따르고, DATABASE_SSL=disable 과 충돌하면 거부', () => {
    const url = 'postgres://u:p@db.example.com:5432/cso_ckp';
    const dev = (extra: Record<string, string>) => loadConfig({ NODE_ENV: 'development', ALLOW_DEV_SECRETS: 'true', ...extra });
    expect(dev({ DATABASE_URL: `${url}?sslmode=require` }).database.ssl).toBe('require');
    expect(dev({ DATABASE_URL: `${url}?sslmode=verify-ca` }).database.ssl).toBe('verify-full');
    expect(dev({ DATABASE_URL: `${url}?sslmode=prefer` }).database.ssl).toBe('disable');
    expect(dev({ DATABASE_URL: url }).database.ssl).toBe('disable');
    expect(dev({ DATABASE_URL: `${url}?sslmode=require`, DATABASE_SSL: 'verify-full' }).database.ssl).toBe('verify-full');
    for (const NODE_ENV of ['development', 'production']) {
      try {
        loadConfig({
          NODE_ENV,
          DATABASE_URL: `${url}?sslmode=require`,
          DATABASE_SSL: 'disable',
          JWT_SECRET: 'x'.repeat(40),
          FILE_TOKEN_SECRET: 'y'.repeat(40),
          CORS_ORIGINS: 'https://app.example.com',
        });
        throw new Error('ConfigError 가 발생해야 합니다');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as ConfigError).problems.join('\n')).toMatch(/sslmode.*DATABASE_SSL=disable/);
      }
    }
  });

  it('TRUST_PROXY: 프록시 수·IP/CIDR 목록만, true 는 운영에서 거부(개발은 경고)', () => {
    const dev = (v: string) => loadConfig({ NODE_ENV: 'development', TRUST_PROXY: v });
    expect(dev('').trustProxy).toBe(false);
    expect(dev('false').trustProxy).toBe(false);
    expect(dev('0').trustProxy).toBe(false);
    expect(dev('1').trustProxy).toBe(1);
    expect(dev('10.0.0.0/8, 127.0.0.1 ,::1').trustProxy).toBe('10.0.0.0/8,127.0.0.1,::1');
    expect(dev('loopback,172.16.0.0/255.240.0.0,fd00::/8').trustProxy).toBe('loopback,172.16.0.0/255.240.0.0,fd00::/8');
    for (const bad of ['yes', '10.0.0.0/33', '999.1.1.1', 'alb.internal', '::1/129']) {
      expect(() => dev(bad)).toThrow(/TRUST_PROXY 값이 올바르지 않습니다/);
    }
    const devTrue = dev('true');
    expect(devTrue.trustProxy).toBe(true);
    expect(getConfigWarnings(devTrue).join('\n')).toMatch(/TRUST_PROXY=true/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@db.example.com:5432/cso_ckp',
        JWT_SECRET: 'x'.repeat(40),
        FILE_TOKEN_SECRET: 'y'.repeat(40),
        CORS_ORIGINS: 'https://app.example.com',
        TRUST_PROXY: 'true',
      }),
    ).toThrow(/TRUST_PROXY=true/);
  });

  it('로그인 IP 한도 기본 30회/분', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).auth.loginIpMaxPerMin).toBe(30);
    expect(loadConfig({ NODE_ENV: 'development', LOGIN_IP_MAX_PER_MIN: '100' }).auth.loginIpMaxPerMin).toBe(100);
    expect(() => loadConfig({ NODE_ENV: 'development', LOGIN_IP_MAX_PER_MIN: '0' })).toThrow(ConfigError);
  });

  it('서버 기동 확인: 실제 DB(DATABASE_URL) + 개발용 비밀키는 ALLOW_DEV_SECRETS 없이는 거부', () => {
    const url = 'postgres://u:p@db.example.com:5432/cso_ckp';
    expect(serverStartProblems(loadConfig({ NODE_ENV: 'development', DATABASE_URL: url })).join('\n')).toMatch(/개발용 비밀키/);
    expect(
      serverStartProblems(loadConfig({ NODE_ENV: 'development', DATABASE_URL: url, JWT_SECRET: DEV_JWT, FILE_TOKEN_SECRET: 'f'.repeat(40) })),
    ).toHaveLength(1);
    expect(serverStartProblems(loadConfig({ NODE_ENV: 'development', DATABASE_URL: url, ALLOW_DEV_SECRETS: 'true' }))).toEqual([]);
    expect(
      serverStartProblems(loadConfig({ NODE_ENV: 'development', DATABASE_URL: url, JWT_SECRET: 'j'.repeat(40), FILE_TOKEN_SECRET: 'f'.repeat(40) })),
    ).toEqual([]);
    expect(serverStartProblems(loadConfig({ NODE_ENV: 'development' }))).toEqual([]); // 내장 개발 DB
  });
});

describe('errors · validation', () => {
  it('DB 테이블 없음(42P01)은 503 SCHEMA_NOT_READY', () => {
    const pgErr = Object.assign(new Error('relation "ckp_app_edi_upload" does not exist'), { code: '42P01', severity: 'ERROR' });
    const e = toAppError(pgErr, { photoMaxBytes: 15 * 1024 * 1024 });
    expect(e.code).toBe('SCHEMA_NOT_READY');
    expect(e.statusCode).toBe(503);
    expect(e.toBody().error.message).not.toMatch(/relation|ckp_app/);
  });

  it('multipart 용량 초과는 413 FILE_TOO_LARGE + MB 안내', () => {
    const e = toAppError(Object.assign(new Error('request file too large'), { code: 'FST_REQ_FILE_TOO_LARGE', statusCode: 413 }), {
      photoMaxBytes: 15 * 1024 * 1024,
    });
    expect(e).toBeInstanceOf(AppError);
    expect(e.statusCode).toBe(413);
    expect(e.message).toBe('사진 용량이 너무 큽니다. 1장당 최대 15MB까지 올릴 수 있습니다.');
  });

  it('parseInput: 한국어 필드 메시지', () => {
    const schema = z.object({
      name: z.string({ error: '거래처명을 입력해 주세요.' }).trim().min(1, '거래처명을 입력해 주세요.').max(100),
      count: z.coerce.number().int().min(1),
      memo: z.string().max(5).optional(),
    });
    try {
      parseInput(schema, { name: '  ', count: 0, memo: '123456' });
      throw new Error('실패해야 합니다');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const body = (err as AppError).toBody();
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.message).toBe('입력한 내용을 확인해 주세요.');
      expect(body.error.fields).toEqual({ name: '거래처명을 입력해 주세요.', count: '1 이상이어야 합니다.', memo: '5자 이하로 입력해 주세요.' });
    }
    expect(() => parseInput(schema, {})).toThrowError('입력한 내용을 확인해 주세요.');
    const memoSchema = z.object({ memo: optionalText(5, '메모는 5자 이하로 입력해 주세요.') });
    expect(parseInput(memoSchema, { memo: '  ' })).toEqual({ memo: null });
    expect(parseInput(memoSchema, {})).toEqual({ memo: null });
    expect(parseInput(memoSchema, { memo: ' 12345 ' })).toEqual({ memo: '12345' });
    expect(() => parseInput(memoSchema, { memo: '123456' })).toThrowError('메모는 5자 이하로 입력해 주세요.');
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('contract', () => {
  it('앱과 서버의 contract.ts 가 동일하다', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const server = await readFile(path.resolve(here, '../src/contract.ts'), 'utf8');
    const app = await readFile(path.resolve(here, '../../ckp-app/src/lib/api/contract.ts'), 'utf8');
    expect(server.replace(/\r\n/g, '\n')).toBe(app.replace(/\r\n/g, '\n'));
  });
});
