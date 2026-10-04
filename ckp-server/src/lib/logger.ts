/**
 * Fastify(pino) 로거 설정. 비밀값이 로그에 남지 않도록 헤더를 가리고, 파일 토큰이 들어간 URL 은 마스킹한다.
 */
import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from '../config.js';

/** /v1/files/<token> 의 토큰 부분을 가린다 */
export function maskUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(/(\/v1\/files\/)[^/?#]+/, '$1***');
}

interface RawReqLike {
  method?: string;
  url?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
}

export function loggerOptions(config: AppConfig): NonNullable<FastifyServerOptions['logger']> {
  if (config.logLevel === 'silent') return false;
  const pretty = config.env === 'development' && process.stdout.isTTY === true;
  return {
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
        'refreshToken',
        'accessToken',
      ],
      censor: '[숨김]',
    },
    serializers: {
      req(req: RawReqLike) {
        return { method: req.method, url: maskUrl(req.url), remoteAddress: req.ip ?? req.socket?.remoteAddress };
      },
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}
