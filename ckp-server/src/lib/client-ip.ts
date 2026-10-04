/**
 * rate limit·로그인 실패 카운터에 쓰는 클라이언트 IP 키.
 *  - request.ip 는 TRUST_PROXY 설정에 따라 Fastify 가 계산한 "신뢰할 수 있는" 클라이언트 주소다.
 *    TRUST_PROXY=1(앞단 프록시 1대) → 그 프록시가 붙인 X-Forwarded-For 의 마지막 값, false → 소켓 주소.
 *    (TRUST_PROXY=true 는 클라이언트가 보낸 X-Forwarded-For 를 그대로 믿으므로 운영에서 금지 — config.ts)
 *  - IPv6 는 /64 대역으로 묶는다: 한 가입자가 대역 안에서 주소를 바꿔 가며 제한을 피하지 못하게 한다
 *    (@fastify/rate-limit 기본 키와 같은 규칙. 사용자 지정 keyGenerator 에는 자동 적용되지 않는다).
 */
import { normalizeIP } from '@fastify/rate-limit';

export const IPV6_SUBNET = 64;

export function clientIpKey(ip: string | undefined | null): string {
  if (!ip) return 'unknown';
  try {
    return normalizeIP(ip, IPV6_SUBNET);
  } catch {
    return ip.toLowerCase();
  }
}
