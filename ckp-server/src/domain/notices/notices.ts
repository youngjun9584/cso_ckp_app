/**
 * 공지사항 조회 (DESIGN §2.4) — public.notice 는 조회 전용.
 *  - important 는 문자열 'true'/'false' (관리자와 같이 정확히 'true' 만 중요로 본다. null 은 일반)
 *  - 정렬: 중요 → reg_ymd desc (null 은 뒤) → idx desc
 *  - 목록에는 contents 를 읽지 않는다. 상세 본문은 sanitizeNoticeHtml 로 정화해서 돌려준다.
 */
import type { NoticeDetail, NoticeSummary } from '../../contract.js';
import type { Queryable } from '../../db/pool.js';
import { sanitizeNoticeHtml } from '../../lib/sanitize.js';
import { escapeLike } from '../../lib/validation.js';

const IMPORTANT_EXPR = `COALESCE(important = 'true', false)`;
export const NOTICE_ORDER_BY = `${IMPORTANT_EXPR} DESC, reg_ymd DESC NULLS LAST, idx DESC`;

// 출력 별칭은 원래 컬럼명과 다르게 둔다(ORDER BY 가 to_char 결과가 아닌 date 컬럼을 쓰도록)
const SUMMARY_COLUMNS = `idx, title::text AS title, author::text AS author, to_char(reg_ymd, 'YYYY-MM-DD') AS reg_ymd_text, ${IMPORTANT_EXPR} AS is_important`;

interface SummaryRow {
  idx: number;
  title: string | null;
  author: string | null;
  reg_ymd_text: string | null;
  is_important: boolean;
}

interface DetailRow extends SummaryRow {
  contents: string | null;
}

function textOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function toSummary(row: SummaryRow): NoticeSummary {
  return {
    idx: row.idx,
    title: textOrNull(row.title) ?? '',
    author: textOrNull(row.author),
    regYmd: row.reg_ymd_text ?? null,
    important: row.is_important === true,
  };
}

export interface NoticeListOptions {
  q: string | undefined;
  limit: number;
  offset: number;
}

export async function listNotices(db: Queryable, opts: NoticeListOptions): Promise<{ items: NoticeSummary[]; total: number }> {
  const params: unknown[] = [];
  let where = '';
  if (opts.q) {
    params.push(`%${escapeLike(opts.q)}%`); // LIKE 기본 이스케이프 문자는 역슬래시
    where = `WHERE title ILIKE $1`;
  }
  const [count, rows] = await Promise.all([
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.notice ${where}`, params),
    db.query<SummaryRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM public.notice ${where} ORDER BY ${NOTICE_ORDER_BY} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, opts.limit, opts.offset],
    ),
  ]);
  return { items: rows.rows.map(toSummary), total: count.rows[0]?.n ?? 0 };
}

export async function findNotice(db: Queryable, idx: number): Promise<NoticeDetail | null> {
  const { rows } = await db.query<DetailRow>(
    `SELECT ${SUMMARY_COLUMNS}, contents::text AS contents FROM public.notice WHERE idx = $1 LIMIT 1`,
    [idx],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...toSummary(row), contentHtml: sanitizeNoticeHtml(row.contents), attachments: [] };
}
