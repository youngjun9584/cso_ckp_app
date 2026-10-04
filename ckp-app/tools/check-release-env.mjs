// EAS/운영 웹 빌드가 샘플 데이터 또는 개발 API를 가리킨 채 배포되는 것을 방지한다.
const value = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
let url;
try { url = new URL(value); } catch { /* 아래 메시지에서 안내 */ }
if (process.env.EXPO_PUBLIC_API_MODE !== 'live' || !url || url.protocol !== 'https:' || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash ||
    /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(url.hostname) ||
    /(^|\.)example\.(com|org|net)$/.test(url.hostname)) {
  console.error('운영 빌드에는 EXPO_PUBLIC_API_MODE=live 및 실제 HTTPS API 원점 주소가 필요합니다. 예시 도메인, localhost, /v1 경로, 비밀값은 사용할 수 없습니다.');
  process.exit(1);
}
console.log('운영 API 주소 설정 확인 완료');
