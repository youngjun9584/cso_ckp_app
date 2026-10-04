// 개발용 PGlite 데이터 폴더를 삭제한다. 다음 npm run dev 실행 시 스키마·샘플 데이터가 다시 만들어진다.
import { rmSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.env.DEV_DB_DIR || '.data/pglite');
rmSync(dir, { recursive: true, force: true });
console.log(`개발 DB 폴더를 삭제했습니다: ${dir}`);
