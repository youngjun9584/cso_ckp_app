/**
 * /v1/notices — 정렬(중요 고정)·제목 검색·페이지·본문 정화 (DESIGN §2.4, §5.5, §5.6)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiErrorBody, NoticeDetailResponse, NoticeListResponse, NoticeSummary } from '../src/contract.js';
import { createTestApp, type TestContext } from './helpers.js';

let t: TestContext;
let auth: { authorization: string };

const SUMMARY_KEYS = ['author', 'idx', 'important', 'regYmd', 'title'];
const DETAIL_KEYS = [...SUMMARY_KEYS, 'attachments', 'contentHtml'].sort();

interface RawNotice {
  idx: number;
  title: string | null;
  important: string | null;
  d: string | null;
}
let raw: RawNotice[] = [];

function expectedOrder(rows: RawNotice[]): number[] {
  return [...rows]
    .sort((a, b) => {
      const ia = a.important === 'true' ? 1 : 0;
      const ib = b.important === 'true' ? 1 : 0;
      if (ia !== ib) return ib - ia;
      if (a.d !== b.d) {
        if (a.d === null) return 1;
        if (b.d === null) return -1;
        return a.d < b.d ? 1 : -1;
      }
      return b.idx - a.idx;
    })
    .map((r) => r.idx);
}

async function list(query: Record<string, string | number> = {}) {
  const qs = new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)])).toString();
  return t.app.inject({ method: 'GET', url: `/v1/notices${qs ? `?${qs}` : ''}`, headers: auth });
}

async function detailByTitle(title: string) {
  const { rows } = await t.db.query<{ idx: number }>('SELECT idx FROM public.notice WHERE title = $1', [title]);
  const idx = rows[0]?.idx;
  expect(idx).toBeDefined();
  const res = await t.app.inject({ method: 'GET', url: `/v1/notices/${idx}`, headers: auth });
  expect(res.statusCode).toBe(200);
  return res.json<NoticeDetailResponse>().notice;
}

beforeAll(async () => {
  t = await createTestApp();
  auth = await t.authHeaders('ckp_demo');
  // 테스트 전용: 제목 없음 / 와일드카드 제목 / 같은 날짜 동률(idx desc 확인)
  await t.db.query(
    `INSERT INTO public.notice (author, title, contents, reg_ymd, important) VALUES
       (NULL, NULL, NULL, '2020-01-01', 'false'),
       ('관리자', '할인율 100% 안내_특별', '<p>본문</p>', '2020-01-02', 'TRUE'),
       ('관리자', '동률 공지 A', '<p>A</p>', '2020-01-03', 'false'),
       ('관리자', '동률 공지 B', '<p>B</p>', '2020-01-03', 'false')`,
  );
  raw = (
    await t.db.query<RawNotice>(`SELECT idx, title, important, to_char(reg_ymd, 'YYYY-MM-DD') AS d FROM public.notice`)
  ).rows;
});

afterAll(async () => {
  await t?.close();
});

describe('GET /v1/notices', () => {
  it('인증이 없으면 401', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/notices' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/v1/notices/1' })).statusCode).toBe(401);
  });

  it('목록에는 본문이 없고 계약 필드만 있다', async () => {
    const res = await list({ pageSize: 100 });
    expect(res.statusCode).toBe(200);
    const body = res.json<NoticeListResponse>();
    expect(body.total).toBe(raw.length);
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(SUMMARY_KEYS);
    expect(res.body).not.toContain('<p>');
    expect(res.body).not.toContain('script');
    expect(res.body).not.toContain('base64');
  });

  it('정렬: 중요 → 등록일 desc(null 은 뒤) → idx desc', async () => {
    const items = (await list({ pageSize: 100 })).json<NoticeListResponse>().items;
    expect(items.map((i) => i.idx)).toEqual(expectedOrder(raw));

    const importantCount = raw.filter((r) => r.important === 'true').length;
    expect(importantCount).toBe(3);
    expect(items.slice(0, importantCount).every((i) => i.important)).toBe(true);
    expect(items.slice(importantCount).every((i) => !i.important)).toBe(true);
    // important 가 null 인 공지는 일반 취급, 'TRUE'(대문자)도 관리자와 같이 일반 취급
    const nullImportant = raw.find((r) => r.important === null);
    expect(items.find((i) => i.idx === nullImportant?.idx)?.important).toBe(false);
    expect(items.find((i) => i.title === '할인율 100% 안내_특별')?.important).toBe(false);
    // 등록일 없는 공지는 맨 뒤
    const noDate = raw.find((r) => r.d === null);
    expect(items[items.length - 1]?.idx).toBe(noDate?.idx);
    expect(items[items.length - 1]?.regYmd).toBeNull();
    // 같은 날짜는 idx desc
    const a = items.findIndex((i) => i.title === '동률 공지 A');
    const b = items.findIndex((i) => i.title === '동률 공지 B');
    expect(b).toBe(a - 1);
    // 날짜 형식, 제목 없음 → ''
    expect(items.every((i) => i.regYmd === null || /^\d{4}-\d{2}-\d{2}$/.test(i.regYmd))).toBe(true);
    expect(items.some((i) => i.title === '' && i.author === null)).toBe(true);
  });

  it('페이지네이션: total/hasMore, 이어 붙이면 전체 순서와 같다', async () => {
    const pageSize = 10;
    const pages = Math.ceil(raw.length / pageSize);
    const seen: NoticeSummary[] = [];
    for (let page = 1; page <= pages; page++) {
      const body = (await list({ page, pageSize })).json<NoticeListResponse>();
      expect(body).toMatchObject({ page, pageSize, total: raw.length, hasMore: page < pages });
      seen.push(...body.items);
    }
    expect(seen.map((i) => i.idx)).toEqual(expectedOrder(raw));
    const beyond = (await list({ page: pages + 1, pageSize })).json<NoticeListResponse>();
    expect(beyond).toMatchObject({ items: [], hasMore: false, total: raw.length });
    expect((await list({ pageSize: 101 })).statusCode).toBe(400);
  });

  it('제목 검색(대소문자 무시)과 와일드카드 이스케이프', async () => {
    const expected = raw.filter((r) => (r.title ?? '').toLowerCase().includes('edi'));
    expect(expected.length).toBeGreaterThan(1);
    const upper = (await list({ q: 'EDI', pageSize: 100 })).json<NoticeListResponse>();
    const lower = (await list({ q: 'edi', pageSize: 100 })).json<NoticeListResponse>();
    expect(upper.total).toBe(expected.length);
    expect(upper.items.map((i) => i.idx)).toEqual(expectedOrder(expected));
    expect(lower.items).toEqual(upper.items);

    const pct = (await list({ q: '%' })).json<NoticeListResponse>();
    expect(pct.items.map((i) => i.title)).toEqual(['할인율 100% 안내_특별']);
    const underscore = (await list({ q: '_' })).json<NoticeListResponse>();
    expect(underscore.items.map((i) => i.title)).toEqual(['할인율 100% 안내_특별']);
    // 본문 내용은 검색 대상이 아니다
    expect((await list({ q: '자세한 사항은 담당자에게' })).json<NoticeListResponse>().total).toBe(0);
    const tooLong = await list({ q: 'a'.repeat(101) });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json<ApiErrorBody>().error.fields?.q).toBe('검색어는 100자 이하로 입력해 주세요.');
  });
});

describe('GET /v1/notices/:idx', () => {
  it('상세: 계약 필드, attachments 는 빈 배열, 중요 여부·날짜', async () => {
    const n = await detailByTitle('2026년 10월 EDI 제출 마감 일정 안내');
    expect(Object.keys(n).sort()).toEqual(DETAIL_KEYS);
    expect(n.attachments).toEqual([]);
    expect(n.important).toBe(true);
    expect(n.author).toBe('관리자');
    expect(n.regYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Quill 정렬 class → style="text-align:center", class 는 제거
    expect(n.contentHtml).toContain('<p style="text-align:center">마감 이후 제출분은 다음 달로 이월됩니다.</p>');
    expect(n.contentHtml).not.toContain('class=');
    expect(n.contentHtml).toContain('<strong>');
  });

  it('XSS 제거: script·onerror·잘못된 img 삭제, 본문 텍스트는 유지', async () => {
    const n = await detailByTitle('거래처 등록 시 사업자등록번호 확인 절차 안내');
    expect(n.contentHtml).not.toMatch(/<script/i);
    expect(n.contentHtml).not.toContain('alert');
    expect(n.contentHtml).not.toMatch(/onerror/i);
    expect(n.contentHtml).not.toContain('<img');
    expect(n.contentHtml).toContain('잘못된 번호는 등록되지 않습니다.');
  });

  it('data: 이미지(base64)는 유지, mailto/tel 링크는 rel·target 강제', async () => {
    const n = await detailByTitle('CKP 업무 앱 출시 및 이용 방법 안내');
    expect(n.contentHtml).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="앱 화면 예시"/);
    expect(n.contentHtml).toContain('<a href="mailto:support@example.com" target="_blank" rel="noopener noreferrer nofollow">');
    expect(n.contentHtml).toContain('href="tel:1588-0000"');
  });

  it('iframe 은 "동영상 보기" 링크로, javascript: 링크는 href 제거', async () => {
    const n = await detailByTitle('EDI 사진 촬영 시 유의사항');
    expect(n.contentHtml).not.toMatch(/<iframe/i);
    expect(n.contentHtml).toContain('<a href="https://www.youtube.com/embed/dQw4w9WgXcQ" target="_blank" rel="noopener noreferrer nofollow">동영상 보기</a>');
    expect(n.contentHtml).not.toContain('javascript:');
    expect(n.contentHtml).toContain('이 링크는 동작하지 않아야 합니다');
  });

  it('인라인 style·이벤트 속성 제거, 표는 유지', async () => {
    const n = await detailByTitle('시스템 정기 점검 안내 (토요일 02:00~04:00)');
    expect(n.contentHtml).not.toContain('color:red');
    expect(n.contentHtml).not.toMatch(/onclick/i);
    expect(n.contentHtml).toContain('<table>');
    expect(n.contentHtml).toContain('<td>토요일 02:00~04:00</td>');
  });

  it('본문이 없으면 빈 문자열, 제목 없음은 빈 문자열', async () => {
    const noTitle = raw.find((r) => r.title === null);
    const res = await t.app.inject({ method: 'GET', url: `/v1/notices/${noTitle?.idx}`, headers: auth });
    expect(res.json<NoticeDetailResponse>().notice).toMatchObject({ title: '', author: null, contentHtml: '', attachments: [] });
  });

  it('없거나 형식이 틀린 idx 는 404 (한국어 메시지)', async () => {
    for (const idx of ['999999', 'abc', '0', '-1', '1.5', '99999999999', '2147483648']) {
      const res = await t.app.inject({ method: 'GET', url: `/v1/notices/${idx}`, headers: auth });
      expect(res.statusCode).toBe(404);
      expect(res.json<ApiErrorBody>().error).toEqual({ code: 'NOT_FOUND', message: '공지사항을 찾을 수 없습니다.' });
    }
  });
});
