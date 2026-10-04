// 빌드 후처리: TypeScript 가 복사하지 않는 SQL 파일을 dist 로 복사한다.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = [['src/db/dev-schema.sql', 'dist/db/dev-schema.sql']];
for (const [from, to] of assets) {
  mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  copyFileSync(path.join(root, from), path.join(root, to));
  console.log(`복사: ${from} → ${to}`);
}
