# CKP 업무 앱 (ckp-app)

Expo SDK 57 · React Native 0.86 · Expo Router · TypeScript — Android / iOS / Web 한 코드베이스.
설계 기준은 `../docs/DESIGN.md`, 기능 개발자용 공통 API 안내는 `src/README-app.md`.

## 실행

```bash
cp .env.example .env        # 비워 두면 샘플 모드 (서버 없이 실행, 로그인 ckp_demo / demo1234)
npx expo start              # w: 웹, Android/iOS: Expo Go 또는 개발 빌드
```

실서버(또는 개발 서버 `ckp-server`)에 연결하려면 `.env` 에 다음을 넣는다.

```
EXPO_PUBLIC_API_BASE_URL=http://<PC IP>:4000
EXPO_PUBLIC_API_MODE=live
```

## 점검

```bash
npx tsc --noEmit
npx expo lint
npx expo export -p web      # dist/ (SPA — 모든 경로를 index.html 로 rewrite 해야 한다)
```
