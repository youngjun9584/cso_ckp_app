/**
 * /v1/notices — 공지사항 조회 (DESIGN §2.4, §5.5, §5.6). 모두 인증 필요.
 *   GET /       ?q=(제목)&page=&pageSize=  → NoticeListResponse (본문 제외)
 *   GET /:idx   → NoticeDetailResponse (정화된 contentHtml, attachments: [])
 */
import type { FastifyInstance } from 'fastify';
import type { RouteOptions } from '../app.js';
import type { NoticeDetailResponse, NoticeListResponse } from '../contract.js';
import { findNotice, listNotices } from '../domain/notices/notices.js';
import { AppError } from '../lib/errors.js';
import { pageOffset, paged, pagingQuery, parseInput, searchText } from '../lib/validation.js';

const NOT_FOUND_MESSAGE = '공지사항을 찾을 수 없습니다.';
const INT4_MAX = 2_147_483_647;

const ListQuery = pagingQuery.extend({ q: searchText });

/** 경로의 idx → 양의 정수 (형식이 틀리면 null → 404) */
function parseIdxParam(params: unknown): number | null {
  const raw = (params as { idx?: unknown } | null)?.idx;
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= INT4_MAX ? n : null;
}

export default async function noticesRoutes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  const { db } = opts.deps;

  app.get('/', { onRequest: app.authenticate }, async (request): Promise<NoticeListResponse> => {
    const query = parseInput(ListQuery, request.query);
    const { limit, offset } = pageOffset(query);
    const { items, total } = await listNotices(db, { q: query.q, limit, offset });
    return paged(items, query, total);
  });

  app.get('/:idx', { onRequest: app.authenticate }, async (request): Promise<NoticeDetailResponse> => {
    const idx = parseIdxParam(request.params);
    if (idx === null) throw new AppError('NOT_FOUND', NOT_FOUND_MESSAGE);
    const notice = await findNotice(db, idx);
    if (!notice) throw new AppError('NOT_FOUND', NOT_FOUND_MESSAGE);
    return { notice };
  });
}
