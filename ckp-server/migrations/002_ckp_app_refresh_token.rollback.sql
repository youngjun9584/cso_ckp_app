-- 002_ckp_app_refresh_token.sql 롤백 (앱 전용 refresh 토큰 기록 테이블만 삭제; 기존 테이블·데이터는 그대로 남는다)
-- 롤백 후 서버를 다시 시작하면 무상태 방식으로 돌아간다. 이미 발급된 토큰은 만료 전까지 계속 쓸 수 있다
-- (로그아웃·재발급으로 폐기했던 기록은 사라진다).
BEGIN;
DROP TABLE IF EXISTS public.ckp_app_refresh_token;
COMMIT;
