// 앱과 서버의 API 계약 파일(contract.ts)이 동일한지 확인한다. 다르면 종료 코드 1.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverFile = path.resolve(here, '../src/contract.ts');
const appFile = path.resolve(here, '../../ckp-app/src/lib/api/contract.ts');

const normalize = (s) => s.replace(/\r\n/g, '\n');
let server;
let app;
try {
  server = normalize(readFileSync(serverFile, 'utf8'));
  app = normalize(readFileSync(appFile, 'utf8'));
} catch (err) {
  console.error(`[계약 확인] 파일을 읽을 수 없습니다: ${err.message}`);
  process.exit(1);
}

if (server === app) {
  console.log('[계약 확인] ckp-server/src/contract.ts 와 ckp-app/src/lib/api/contract.ts 가 동일합니다.');
  process.exit(0);
}

const a = server.split('\n');
const b = app.split('\n');
const max = Math.max(a.length, b.length);
for (let i = 0; i < max; i++) {
  if (a[i] !== b[i]) {
    console.error(`[계약 확인] 두 파일이 다릅니다. 처음 다른 줄: ${i + 1}`);
    console.error(`  서버: ${a[i] ?? '(없음)'}`);
    console.error(`  앱  : ${b[i] ?? '(없음)'}`);
    break;
  }
}
process.exit(1);
