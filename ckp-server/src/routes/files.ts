/**
 * /v1/files — 서명 이미지 전달 (DESIGN §5.7). Authorization 불필요, 토큰(HMAC·만료 1시간)으로만 접근.
 *   GET /v1/files/<token>
 * 토큰이 위조·만료됐거나, 토큰 사용자가 더 이상 승인 상태가 아니거나, 이미지가 그 사용자 것이 아니면 404.
 * 토큰 길이(약 150자)가 Fastify 기본 경로 파라미터 한도(100자)를 넘어서 와일드카드 경로로 받는다.
 */
import type { FastifyInstance } from 'fastify';
import type { RouteOptions } from '../app.js';
import { resolveFileImage } from '../domain/edi/images.js';
import { AppError } from '../lib/errors.js';
import { isApproved } from '../services/users.js';

export const FILE_NOT_FOUND_MESSAGE = '이미지를 찾을 수 없거나 주소가 만료되었습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.';
export const FILE_CACHE_CONTROL = 'private, max-age=3600';

export default async function filesRoutes(app: FastifyInstance, opts: RouteOptions): Promise<void> {
  const deps = opts.deps;

  app.get('/*', async (request, reply) => {
    const token = (request.params as { '*'?: string })['*'] ?? '';
    const payload = token && !token.includes('/') ? deps.tokens.verifyFileToken(token) : null;
    if (!payload) throw new AppError('NOT_FOUND', FILE_NOT_FOUND_MESSAGE);

    const owner = await app.userStatusCache.get(payload.u);
    if (!owner || !isApproved(owner.aprYn)) throw new AppError('NOT_FOUND', FILE_NOT_FOUND_MESSAGE);

    const image = await resolveFileImage(deps, payload, request.log);
    if (!image) throw new AppError('NOT_FOUND', FILE_NOT_FOUND_MESSAGE);

    reply.header('cache-control', FILE_CACHE_CONTROL).header('content-type', image.contentType);
    return reply.send(image.buffer);
  });
}
