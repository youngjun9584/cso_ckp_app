-- ============================================================================
-- CKP 앱 API 전용 테이블 (추가 전용 마이그레이션, 선택 사항)
--   * refresh 토큰 발급 기록: 재발급 시 이전 토큰 폐기(rotation), 폐기된 토큰 재사용 감지 시 같은 로그인(family) 전체 폐기,
--     로그아웃 시 family 폐기 — 서버를 다시 시작해도 유지된다.
--   * 이 테이블이 없으면 서버는 기존처럼 무상태(JWT 만) 방식으로 동작한다(로그아웃 폐기는 메모리, 재시작 시 초기화).
--   * 기존 테이블(edi, mannager_by_hospital, sys_app_usr_mng 등)은 변경하지 않는다. 관리자 화면과 무관.
--   * 토큰 원문은 저장하지 않는다(token_hash = sha256(토큰) hex).
--   * 적용 전 운영 DB 백업 및 DBA 검토 필수. 롤백: 002_ckp_app_refresh_token.rollback.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ckp_app_refresh_token (
    token_id     uuid          PRIMARY KEY,           -- = JWT jti
    usr_id       varchar(50)   NOT NULL,              -- sys_app_usr_mng.usr_id
    family_id    uuid          NOT NULL,              -- 로그인 1회에서 이어지는 토큰 묶음
    token_hash   char(64)      NOT NULL UNIQUE,       -- sha256(refresh 토큰) 소문자 hex
    issued_at    timestamptz   NOT NULL DEFAULT now(),
    expires_at   timestamptz   NOT NULL,
    revoked_at   timestamptz,                         -- 재발급·로그아웃·재사용 감지로 폐기된 시각
    replaced_by  uuid                                 -- 재발급으로 폐기된 경우 새 토큰의 token_id
);

CREATE INDEX IF NOT EXISTS ckp_app_refresh_token_family_idx
    ON public.ckp_app_refresh_token (family_id);

CREATE INDEX IF NOT EXISTS ckp_app_refresh_token_expires_idx
    ON public.ckp_app_refresh_token (expires_at);

COMMIT;
