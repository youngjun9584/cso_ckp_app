-- ============================================================================
-- CKP 앱 API 전용 테이블 (추가 전용 마이그레이션)
--   * 기존 테이블(edi, mannager_by_hospital, sys_app_usr_mng 등)은 변경하지 않는다.
--   * 관리자(Java/eGov) 화면은 계속 edi 테이블만 읽으므로 영향 없음.
--   * 목적: EDI 제출 건 묶음·사진 순번·메모·중복 제출 방지(Idempotency) 저장
--   * 적용 전 운영 DB 백업 및 DBA 검토 필수. 롤백: 001_ckp_app_edi.rollback.sql
-- ============================================================================

BEGIN;

-- 사진 업로드 원장: 업로드 성공한 파일(저장소 키)과 소유자, 사용 여부
CREATE TABLE IF NOT EXISTS public.ckp_app_edi_upload (
    upload_id        uuid          PRIMARY KEY,
    usr_id           varchar(50)   NOT NULL,              -- sys_app_usr_mng.usr_id
    client_photo_id  uuid          NOT NULL,              -- 앱이 사진마다 생성한 ID (재업로드 중복 방지)
    storage_driver   varchar(10)   NOT NULL,              -- 's3' | 'local'
    object_key       varchar(300)  NOT NULL UNIQUE,       -- 원본(정규화 JPEG) 저장 키
    thumb_key        varchar(300)  NOT NULL,              -- 썸네일 저장 키
    public_url       varchar(200),                        -- edi.aws_url 에 기록할 URL (S3)
    content_type     varchar(50)   NOT NULL,
    bytes            integer       NOT NULL CHECK (bytes > 0),
    width            integer       NOT NULL CHECK (width > 0),
    height           integer       NOT NULL CHECK (height > 0),
    sha256           char(64)      NOT NULL,
    status           varchar(10)   NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'USED', 'DELETED')),
    created_at       timestamptz   NOT NULL DEFAULT now(),
    used_at          timestamptz,
    CONSTRAINT ckp_app_edi_upload_owner_photo_uk UNIQUE (usr_id, client_photo_id),
    CONSTRAINT ckp_app_edi_upload_url_ck CHECK (public_url IS NULL OR length(public_url) <= 200)
);

CREATE INDEX IF NOT EXISTS ckp_app_edi_upload_status_created_idx
    ON public.ckp_app_edi_upload (status, created_at);

-- EDI 제출 건: 한 번의 "사진 N장 등록하기" = 1행
CREATE TABLE IF NOT EXISTS public.ckp_app_edi_submission (
    submission_id    uuid          PRIMARY KEY,
    usr_id           varchar(50)   NOT NULL,
    idempotency_key  uuid          NOT NULL,
    request_hash     char(64)      NOT NULL,              -- 요청 내용 해시 (같은 키 다른 내용 → 409)
    client_idx       integer       NOT NULL,              -- mannager_by_hospital.idx
    client_name      varchar(100)  NOT NULL,              -- = edi.hospital_name (등록 시점 이름)
    target_ym        char(7)       NOT NULL,              -- 'YYYY-MM' 대상 연월(절대값)
    month_label      varchar(50)   NOT NULL,              -- = edi.month ('당월'|'전월'|'전전월')
    memo             varchar(500),
    photo_count      smallint      NOT NULL CHECK (photo_count BETWEEN 1 AND 30),
    create_at_kst    varchar(19)   NOT NULL,              -- = edi.create_at (모든 사진 동일)
    reg_ymd          date          NOT NULL,              -- = edi.reg_ymd (KST)
    created_at       timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT ckp_app_edi_submission_idem_uk UNIQUE (usr_id, idempotency_key),
    CONSTRAINT ckp_app_edi_submission_month_ck CHECK (month_label IN ('당월', '전월', '전전월')),
    CONSTRAINT ckp_app_edi_submission_ym_ck CHECK (target_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE INDEX IF NOT EXISTS ckp_app_edi_submission_user_reg_idx
    ON public.ckp_app_edi_submission (usr_id, reg_ymd DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS ckp_app_edi_submission_user_client_idx
    ON public.ckp_app_edi_submission (usr_id, client_idx, target_ym);

-- 제출 건의 사진 순번: seq 1..N ↔ edi.idx
-- edi 행은 관리자가 삭제할 수 있으므로 edi.idx 에 FK 를 걸지 않는다.
CREATE TABLE IF NOT EXISTS public.ckp_app_edi_submission_photo (
    submission_id    uuid          NOT NULL
                     REFERENCES public.ckp_app_edi_submission (submission_id) ON DELETE CASCADE,
    seq              smallint      NOT NULL CHECK (seq BETWEEN 1 AND 30),
    edi_idx          integer       NOT NULL UNIQUE,
    upload_id        uuid          NOT NULL UNIQUE
                     REFERENCES public.ckp_app_edi_upload (upload_id),
    PRIMARY KEY (submission_id, seq)
);

COMMIT;
