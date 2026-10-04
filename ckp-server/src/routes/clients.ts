/**
 * /v1/clients — 거래처 (DESIGN §2.2, §5.5). 모두 인증 필요, 항상 로그인 사용자 소유 거래처만 다룬다.
 *   GET  /                 ?q=&page=&pageSize=        → ClientListResponse (이름 순 hospital COLLATE "C")
 *   GET  /check-duplicate  ?name=&bizNo=&excludeIdx=  → ClientDuplicateCheckResponse
 *   GET  /:idx             → ClientDetailResponse (내 거래처가 아니면 404)
 *   POST /                 ClientCreateRequest → 201 ClientDetailResponse (approval=false)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteOptions } from '../app.js';
import type { ClientDetailResponse, ClientDuplicateCheckResponse, ClientListResponse } from '../contract.js';
import {
  checkClientDuplicate,
  CLIENT_NOT_FOUND_MESSAGE,
  createClient,
  findClient,
  listClients,
  type ClientRepoOptions,
} from '../domain/clients/clients.js';
import { clientFieldLimits, validateClientCreate } from '../domain/clients/validation.js';
import { AppError } from '../lib/errors.js';
import { pageOffset, paged, pagingQuery, parseInput, searchText } from '../lib/validation.js';
import { requireUser } from '../plugins/auth.js';

const INT4_MAX = 2_147_483_647;

const ListQuery = pagingQuery.extend({ q: searchText });

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const DuplicateQuery = z.object({
  name: z.string({ error: '거래처명 형식이 올바르지 않습니다.' }).max(500, '거래처명이 너무 깁니다.').optional(),
  bizNo: z.string({ error: '사업자등록번호 형식이 올바르지 않습니다.' }).max(100, '사업자등록번호가 너무 깁니다.').optional(),
  excludeIdx: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: '제외할 거래처 번호가 올바르지 않습니다.' })
      .int('제외할 거래처 번호가 올바르지 않습니다.')
      .min(1, '제외할 거래처 번호가 올바르지 않습니다.')
      .max(INT4_MAX, '제외할 거래처 번호가 올바르지 않습니다.')
      .optional(),
  ),
});

/** 경로의 idx → 양의 정수 (형식이 틀리면 null → 404) */
function parseIdxParam(params: unknown): number | null {
  const raw = (params as { idx?: unknown } | null)?.idx;
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= INT4_MAX ? n : null;
}

export default async function clientsRoutes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  const { db, config, capabilities } = opts.deps;
  const repo: ClientRepoOptions = {
    hospitalType: capabilities.clientHospitalType,
    approvalRequiredForEdi: config.features.clientApprovalRequiredForEdi,
  };
  const limits = clientFieldLimits(capabilities);

  app.get('/', { onRequest: app.authenticate }, async (request): Promise<ClientListResponse> => {
    const user = requireUser(request);
    const query = parseInput(ListQuery, request.query);
    const { limit, offset } = pageOffset(query);
    const { items, total } = await listClients(db, user.usrId, { q: query.q, limit, offset }, repo);
    return paged(items, query, total);
  });

  app.get('/check-duplicate', { onRequest: app.authenticate }, async (request): Promise<ClientDuplicateCheckResponse> => {
    const user = requireUser(request);
    const query = parseInput(DuplicateQuery, request.query);
    return checkClientDuplicate(db, user.usrId, query, limits);
  });

  app.get('/:idx', { onRequest: app.authenticate }, async (request): Promise<ClientDetailResponse> => {
    const user = requireUser(request);
    const idx = parseIdxParam(request.params);
    if (idx === null) throw new AppError('NOT_FOUND', CLIENT_NOT_FOUND_MESSAGE);
    const client = await findClient(db, user.usrId, idx, repo);
    if (!client) throw new AppError('NOT_FOUND', CLIENT_NOT_FOUND_MESSAGE);
    return { client };
  });

  app.post('/', { onRequest: app.authenticate }, async (request, reply): Promise<ClientDetailResponse> => {
    const user = requireUser(request);
    const input = validateClientCreate(request.body, limits);
    const client = await createClient(db, user.usrId, input, repo);
    reply.code(201);
    return { client };
  });
}
