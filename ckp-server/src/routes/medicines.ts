/**
 * /v1/medicines — 의약품 조회 (DESIGN §2.3, §5.5). 모두 인증 필요.
 *   GET /        ?q=&field=name|company|code|all&page=&pageSize=  → MedicineListResponse
 *   GET /:code   → MedicineDetailResponse (없으면 404 '의약품을 찾을 수 없습니다.')
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteOptions } from '../app.js';
import type { MedicineDetailResponse, MedicineListResponse } from '../contract.js';
import { findMedicine, listMedicines, MEDICINE_SEARCH_FIELDS, resolveFeeColumn } from '../domain/medicines/medicines.js';
import { AppError } from '../lib/errors.js';
import { pageOffset, paged, pagingQuery, parseInput, searchText } from '../lib/validation.js';

const NOT_FOUND_MESSAGE = '의약품을 찾을 수 없습니다.';

const ListQuery = pagingQuery.extend({
  q: searchText,
  field: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.enum(MEDICINE_SEARCH_FIELDS, { error: '검색 기준이 올바르지 않습니다.' }).default('name'),
  ),
});

const CodeParams = z.object({ code: z.string() });

export default async function medicinesRoutes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  const { db, config, capabilities } = opts.deps;

  app.get('/', { onRequest: app.authenticate }, async (request): Promise<MedicineListResponse> => {
    const query = parseInput(ListQuery, request.query);
    const fee = await resolveFeeColumn(db, capabilities, config.features.medicineFeeVisible);
    const { limit, offset } = pageOffset(query);
    const { items, total } = await listMedicines(db, { q: query.q, field: query.field, limit, offset, fee });
    return paged(items, query, total);
  });

  app.get('/:code', { onRequest: app.authenticate }, async (request): Promise<MedicineDetailResponse> => {
    const code = parseInput(CodeParams, request.params).code.trim();
    if (!code || code.length > 100) throw new AppError('NOT_FOUND', NOT_FOUND_MESSAGE);
    const fee = await resolveFeeColumn(db, capabilities, config.features.medicineFeeVisible);
    const medicine = await findMedicine(db, code, fee);
    if (!medicine) throw new AppError('NOT_FOUND', NOT_FOUND_MESSAGE);
    return { medicine };
  });
}
