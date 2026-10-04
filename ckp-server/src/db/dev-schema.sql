-- ============================================================================
-- 개발/테스트 전용: cso_ckp 기존 테이블 모양 재현 (PGlite 에서만 실행)
--   운영 DB 에는 절대 실행하지 않는다. 컬럼명·타입은 참고 코드(Prisma 모델, Java 매퍼) 분석 결과 기준.
--   추가 전용 테이블(ckp_app_*)은 migrations/001_ckp_app_edi.sql 로 따로 만든다.
-- ============================================================================

-- 앱 사용자 (현장 영업) — 인증 대상
CREATE TABLE IF NOT EXISTS public.sys_app_usr_mng (
    usr_id                   varchar(20)  PRIMARY KEY,
    usr_pwd                  varchar(200) NOT NULL,
    usr_nam                  varchar(20),
    tel                      varchar(15),
    phone                    varchar(15),
    email                    varchar(200),
    address                  varchar(300),
    cpy_nam                  varchar(50),
    cpy_number               varchar(200),
    cpy_address              varchar(300),
    bankbook_name            varchar(200),
    bankbook_number          varchar(200),
    bankbook_security_number varchar(200),
    apr_yn                   char(1),
    last_ymd                 date,
    join_ymd                 date,
    role_id                  varchar(5),
    gbn                      varchar(10),
    sessionkey               char(40),
    user_ip                  varchar(50),
    use_ymd                  date,
    cpy_image                bytea,
    bankbook_image           bytea,
    classification           varchar(200),
    client                   varchar(40),
    coalition_company        varchar(200)
);

-- 관리자 담당자 목록: 로그인 ID와 동일한 user_id로 연결
CREATE TABLE IF NOT EXISTS public.manager (
    user_id varchar(100) PRIMARY KEY,
    idx serial NOT NULL,
    name varchar(100),
    reg_ymd date,
    manager varchar(100),
    company varchar(100)
);

-- 거래처 (테이블명 오타가 실제 이름) — 기본 12컬럼 + cso_ckp 전용 컬럼 일부
CREATE TABLE IF NOT EXISTS public.mannager_by_hospital (
    idx                 serial       PRIMARY KEY,
    hospital            varchar(100),
    user_id             varchar(100) NOT NULL,
    doctor_name         varchar(100),
    cpy_number          varchar(100),
    address             varchar(100),
    dispensary          varchar(100),
    care_code           varchar(50),
    phone               varchar(20),
    zip_code            varchar(10),
    ee                  varchar(200),
    approval            boolean,
    hospital_type       varchar(100),
    excel_hospital_name varchar(200),
    self_code           varchar(100),
    deal_type           varchar(100),
    department          varchar(200),
    close_yn            varchar(50),
    deal_start_date     date
);

-- 의약품 (PK: medicine_code, idx 는 PK 아님)
CREATE TABLE IF NOT EXISTS public.medicine (
    idx               serial,
    medicine_code     varchar(100)  PRIMARY KEY,
    name              varchar(100),
    type1             varchar(100),
    type2             varchar(100),
    medicine_class    varchar(2000),
    company           varchar(100),
    pay               varchar(100)  NOT NULL,
    ingredient        varchar(2000),
    medicine_add      varchar(2000),
    medicine_packing  varchar(2000),
    ee                varchar(2000),
    ee2               varchar(2000),
    reg_ymd           date,
    image_url         varchar(500),
    tax               varchar(50),
    tax_2             varchar(50),
    tax_3             varchar(50),
    tax_4             varchar(50),
    decrease_tax      varchar(50),
    contrast_medicine varchar(200),
    welfare_code      varchar(50),
    medicine_is       varchar(10),
    is_live           varchar(50),
    is_maker          varchar(50)
);

-- 수수료 표시 설정 (PK 없음). idx 는 medicine 의 수수료 컬럼명, list=true 인 행의 컬럼을 표시
CREATE TABLE IF NOT EXISTS public.frees (
    idx  varchar(50),
    name varchar(200),
    list boolean
);

-- 공지사항 (contents: Quill HTML, important: 문자열 'true'/'false')
CREATE TABLE IF NOT EXISTS public.notice (
    idx       serial       PRIMARY KEY,
    author    varchar(200),
    title     varchar(200),
    contents  text,
    reg_ymd   date,
    important varchar(20)
);

-- EDI (사진 1장 = 1행)
CREATE TABLE IF NOT EXISTS public.edi (
    idx           serial       PRIMARY KEY,
    deal_type     varchar(50),
    hospital_name varchar(100),
    pharmacist    varchar(600),
    user_id       varchar(50),
    reg_ymd       date,
    edi_image     bytea,
    print         boolean,
    month         varchar(50),
    region        varchar(50),
    is_ocr        boolean      DEFAULT false,
    ocr           text,
    aws_url       varchar(200),
    move_month    boolean,
    create_at     varchar(100),
    is_copy       boolean
);

-- EDI 등록 차단 스위치 (PK 없음). edi = true 이면 차단
CREATE TABLE IF NOT EXISTS public.is_edi (
    edi               boolean,
    coalition_company varchar(200)
);
