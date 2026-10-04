-- 001_ckp_app_edi.sql 롤백 (앱 전용 테이블만 삭제; edi 등 기존 테이블·데이터는 그대로 남는다)
-- 주의: 제출 건 묶음·순번·메모 정보가 사라진다. edi 행과 저장소의 사진 파일은 삭제되지 않는다.
BEGIN;
DROP TABLE IF EXISTS public.ckp_app_edi_submission_photo;
DROP TABLE IF EXISTS public.ckp_app_edi_submission;
DROP TABLE IF EXISTS public.ckp_app_edi_upload;
COMMIT;
