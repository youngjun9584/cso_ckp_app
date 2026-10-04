/**
 * 응답에 넣을 절대 URL 만들기. PUBLIC_BASE_URL 이 있으면 그것을, 없으면 요청의 프로토콜·Host 를 사용한다
 * (프록시 뒤에서는 TRUST_PROXY=1(앞단 프록시 수) 또는 프록시 IP/CIDR 을 설정해야 X-Forwarded-Proto/Host 가 반영된다.
 *  TRUST_PROXY=true 는 클라이언트가 보낸 X-Forwarded-For 를 믿게 되므로 운영에서 거부된다).
 */
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import { fileUrlFromToken } from './tokens.js';

export function requestBaseUrl(request: FastifyRequest, config: AppConfig): string {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  return `${request.protocol}://${request.host}`;
}

/** 서명된 파일 토큰 → 절대 URL (예: https://api.example.com/v1/files/<token>) */
export function buildFileUrl(request: FastifyRequest, config: AppConfig, token: string): string {
  return fileUrlFromToken(token, requestBaseUrl(request, config));
}
