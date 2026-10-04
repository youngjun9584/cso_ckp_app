import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const problems = [];
function read(name) {
  try { return parseEnv(readFileSync(new URL(name, import.meta.url), 'utf8')); }
  catch { problems.push(`${name} 파일을 만들고 운영 값을 입력하세요.`); return {}; }
}
const web = read('.env');
const server = read('.env.server');
const domain = web.APP_DOMAIN ?? '';
if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain) || /(^|\.)example\.(com|org|net)$/i.test(domain)) {
  problems.push('APP_DOMAIN에 실제 도메인을 입력하세요(https:// 및 경로 제외).');
}
let db;
try { db = new URL(server.DATABASE_URL); } catch { /* 아래 검증 */ }
if (!db || !['postgres:', 'postgresql:'].includes(db.protocol) || !db.username || !db.password || /REPLACE/i.test(server.DATABASE_URL)) {
  problems.push('DATABASE_URL에 실제 PostgreSQL 연결 정보를 입력하세요.');
}
for (const key of ['JWT_SECRET', 'FILE_TOKEN_SECRET']) {
  if (!server[key] || server[key].length < 32 || /^(REPLACE|dev-only)/i.test(server[key])) problems.push(`${key}에 새 임의 값(32자 이상)을 입력하세요.`);
}
if (server.JWT_SECRET === server.FILE_TOKEN_SECRET) problems.push('두 서명 비밀키는 서로 달라야 합니다.');
if (!['require', 'verify-full'].includes(server.DATABASE_SSL)) problems.push('DATABASE_SSL은 require 또는 verify-full로 설정하세요.');
if (server.STORAGE_DRIVER !== 's3' || !server.S3_BUCKET || /REPLACE/i.test(server.S3_BUCKET)) problems.push('S3 저장소와 실제 버킷 이름을 설정하세요.');
if (Boolean(server.AWS_ACCESS_KEY_ID) !== Boolean(server.AWS_SECRET_ACCESS_KEY)) problems.push('AWS 키 쌍을 모두 입력하거나 IAM 역할을 위해 둘 다 비워 두세요.');
if (problems.length) {
  console.error('배포 설정을 완료하지 못했습니다:\n' + problems.map((p) => `- ${p}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('설정 형식 검사 통과. DB 연결·권한, S3, DNS, HTTPS는 실제 서버에서 별도 확인해야 합니다.');
}
