import { defineConfig } from 'vitest/config';

// 테스트는 항상 인메모리 PGlite(개발 DB)와 임시 로컬 저장소만 사용한다. 실제 DB/S3 에 접속하지 않는다.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 90_000,
    teardownTimeout: 30_000,
    // PGlite 인스턴스는 파일마다 새로 띄운다. 메모리를 고려해 동시 실행 파일 수를 제한한다.
    maxWorkers: 4,
    env: {
      NODE_ENV: 'test',
    },
  },
});
