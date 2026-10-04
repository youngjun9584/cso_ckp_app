/**
 * 환경변수 → AppConfig (zod 검증). 비밀값은 로그에 남기지 않는다(describeConfig 사용).
 * 운영(NODE_ENV=production) 보호 규칙:
 *   - DATABASE_URL, JWT_SECRET, FILE_TOKEN_SECRET 필수 (개발용 기본 비밀키 사용 금지)
 *   - DEV_DB(PGlite) 사용 금지, CORS '*' 금지, COOKIE_SECURE=false 금지
 *   - TRUST_PROXY=true 금지(클라이언트가 보낸 X-Forwarded-For 를 믿게 됨) → 프록시 수(1) 또는 IP/CIDR 목록
 *   - DB 연결이 암호화되지 않으면(DATABASE_SSL=disable) 경고
 * 모든 환경: DATABASE_URL 의 sslmode=require 등과 DATABASE_SSL=disable 이 충돌하면 오류(몰래 평문 연결 방지).
 * 서버 기동 전용(serverStartProblems): DATABASE_URL + 개발용 비밀키 조합은 ALLOW_DEV_SECRETS=true 없이는 기동 거부.
 */
import { isIP } from 'node:net';
import { z } from 'zod';

export type NodeEnv = 'development' | 'production' | 'test';
export type DatabaseSslMode = 'require' | 'verify-full' | 'disable';
export type StorageDriver = 'local' | 's3';

export interface AppConfig {
  env: NodeEnv;
  isProduction: boolean;
  port: number;
  host: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  database: {
    /** 없으면 개발용 DB(devDb) 사용 */
    url: string | null;
    ssl: DatabaseSslMode;
  };
  devDb: {
    /** DATABASE_URL 이 없고 DEV_DB=pglite 인 경우 true */
    enabled: boolean;
    dir: string;
  };
  auth: {
    jwtSecret: string;
    fileTokenSecret: string;
    accessTtlMin: number;
    refreshTtlDays: number;
    cookieSecure: boolean;
    passwordRehashOnLogin: boolean;
    /** 개발용 기본 비밀키를 쓰고 있는지 (경고 출력용) */
    usingDevSecrets: boolean;
    /** DATABASE_URL 이 있어도 개발용 비밀키로 서버 기동 허용 (ALLOW_DEV_SECRETS, 로컬 개발 DB 전용) */
    allowDevSecrets: boolean;
    /** 로그인 요청 IP당 1분 최대 횟수 (아이디와 무관, LOGIN_IP_MAX_PER_MIN) */
    loginIpMaxPerMin: number;
  };
  cors: { origins: string[] };
  /** false | 프록시 수(n) | IP/CIDR 목록('10.0.0.0/8,127.0.0.1'). true 는 운영에서 거부 */
  trustProxy: boolean | number | string;
  /** 사진 조회 URL 기준 주소. null 이면 요청 Host 로 만든다 */
  publicBaseUrl: string | null;
  storage: {
    driver: StorageDriver;
    localDir: string;
    /** 저장소 키 접두어 (S3/로컬 공통). 예: uploads/users/ckp */
    keyPrefix: string;
    s3: {
      bucket: string | null;
      region: string;
      publicBaseUrl: string | null;
    };
  };
  legacyImageUrlPrefixes: string[];
  photo: {
    maxBytes: number;
    minLongSide: number;
  };
  features: {
    clientApprovalRequiredForEdi: boolean;
    medicineFeeVisible: boolean;
  };
  edi: {
    dealType: string;
  };
  /** 앱 회원가입(승인 대기 신청) — /v1/auth/check-id, /v1/auth/register */
  registration: {
    /** SELF_REGISTRATION_ENABLED (기본 true). false 면 403 REGISTRATION_DISABLED, meta.features.selfRegistration=false */
    enabled: boolean;
    /** 가입 신청 계정의 role_id (REGISTER_ROLE_ID, 기본 R0004=일반사용자). 빈 값이면 null(NULL 저장) */
    roleId: string | null;
    /** IP당 10분 최대 가입 요청 수 (결과와 무관, REGISTER_IP_MAX_PER_10MIN) */
    ipMaxPer10Min: number;
    /** 서버 전체 1시간 최대 가입 완료 수 (REGISTER_MAX_PER_HOUR) */
    maxPerHour: number;
  };
}

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`서버 설정 오류:\n - ${problems.join('\n - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** 개발/테스트 전용 기본 비밀키 (운영에서는 사용 금지 — 'dev-only' 접두어로 감지) */
export const DEV_JWT_SECRET = 'dev-only-jwt-secret-7f3a9c2e5b8d41f6a0c9e2b5d8f1a4c7';
export const DEV_FILE_TOKEN_SECRET = 'dev-only-file-token-secret-3b6e9a1d4c7f02e5b8a1d4c7e0f3a6b9';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = z.preprocess(emptyToUndefined, z.string().trim().optional());
const bool = (def: boolean) => z.preprocess(emptyToUndefined, z.stringbool().optional()).transform((v) => v ?? def);
const int = (def: number, min: number, max: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).optional()).transform((v) => v ?? def);
const list = z.preprocess(emptyToUndefined, z.string().optional()).transform((v) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(['development', 'production', 'test']).default('development')),
  PORT: int(4000, 1, 65535),
  HOST: z.preprocess(emptyToUndefined, z.string().default('0.0.0.0')),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
  DATABASE_URL: optStr,
  DATABASE_SSL: z.preprocess(emptyToUndefined, z.enum(['require', 'verify-full', 'disable']).optional()),
  DEV_DB: z.preprocess(emptyToUndefined, z.enum(['pglite', 'off', 'none', 'false']).optional()),
  DEV_DB_DIR: z.preprocess(emptyToUndefined, z.string().default('.data/pglite')),
  JWT_SECRET: optStr,
  FILE_TOKEN_SECRET: optStr,
  ACCESS_TOKEN_TTL_MIN: int(30, 1, 24 * 60),
  REFRESH_TOKEN_TTL_DAYS: int(14, 1, 365),
  CORS_ORIGINS: list,
  COOKIE_SECURE: z.preprocess(emptyToUndefined, z.stringbool().optional()),
  ALLOW_DEV_SECRETS: bool(false),
  LOGIN_IP_MAX_PER_MIN: int(30, 1, 100_000),
  TRUST_PROXY: optStr,
  PUBLIC_BASE_URL: optStr,
  STORAGE_DRIVER: z.preprocess(emptyToUndefined, z.enum(['local', 's3']).default('local')),
  LOCAL_STORAGE_DIR: z.preprocess(emptyToUndefined, z.string().default('.data/uploads')),
  S3_BUCKET: optStr,
  S3_REGION: z.preprocess(emptyToUndefined, z.string().default('ap-northeast-2')),
  S3_KEY_PREFIX: z.preprocess(emptyToUndefined, z.string().default('uploads/users/ckp')),
  S3_PUBLIC_BASE_URL: optStr,
  LEGACY_IMAGE_URL_PREFIXES: list,
  PHOTO_MAX_BYTES: int(15 * 1024 * 1024, 100 * 1024, 100 * 1024 * 1024),
  PHOTO_MIN_LONG_SIDE: int(400, 1, 10000),
  CLIENT_APPROVAL_REQUIRED_FOR_EDI: bool(true),
  MEDICINE_FEE_VISIBLE: bool(true),
  EDI_DEAL_TYPE: z.preprocess(emptyToUndefined, z.string().max(50).default('기존')),
  PASSWORD_REHASH_ON_LOGIN: bool(false),
  SELF_REGISTRATION_ENABLED: bool(true),
  // 빈 문자열은 'NULL 로 저장'이라는 뜻이므로 emptyToUndefined 를 쓰지 않는다(값 확인은 loadConfig 에서)
  REGISTER_ROLE_ID: z.string().optional(),
  REGISTER_IP_MAX_PER_10MIN: int(5, 1, 100_000),
  REGISTER_MAX_PER_HOUR: int(100, 1, 1_000_000),
});

/** 가입 신청 계정의 기본 역할: sys_role_mng R0004 = '일반사용자' (구 앱과 동일) */
export const DEFAULT_REGISTER_ROLE_ID = 'R0004';
/** sys_app_usr_mng.role_id varchar(5) */
const ROLE_ID_MAX_LENGTH = 5;

const ENV_LABEL: Record<string, string> = {
  NODE_ENV: 'NODE_ENV(development|production|test)',
  DATABASE_SSL: 'DATABASE_SSL(require|verify-full|disable)',
  DEV_DB: 'DEV_DB(pglite 또는 비움)',
  STORAGE_DRIVER: 'STORAGE_DRIVER(local|s3)',
};

const TRUST_PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

/** proxy-addr 가 이해하는 항목인지: IP, IP/접두어 길이, IPv4/넷마스크, loopback·linklocal·uniquelocal */
function isTrustProxyEntry(entry: string): boolean {
  if (TRUST_PROXY_KEYWORDS.has(entry.toLowerCase())) return true;
  const slash = entry.indexOf('/');
  const ip = slash < 0 ? entry : entry.slice(0, slash);
  const family = isIP(ip);
  if (family === 0) return false;
  if (slash < 0) return true;
  const range = entry.slice(slash + 1);
  if (/^\d{1,3}$/.test(range)) return Number(range) <= (family === 4 ? 32 : 128);
  return family === 4 && isIP(range) === 4;
}

interface TrustProxyParse {
  value: boolean | number | string;
  /** 형식 오류 (한국어) */
  invalid?: string;
}

/** TRUST_PROXY: 비움/false/0 → false, 숫자 → 앞단 프록시 수, true → true(운영 금지), 그 외 → IP/CIDR 목록(형식 확인) */
function parseTrustProxy(raw: string | undefined): TrustProxyParse {
  if (raw === undefined) return { value: false };
  const v = raw.trim().toLowerCase();
  if (v === 'true') return { value: true };
  if (v === 'false' || v === '' || v === '0') return { value: false };
  if (/^\d+$/.test(v)) return { value: Number(v) };
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = entries.filter((x) => !isTrustProxyEntry(x));
  if (entries.length === 0 || bad.length > 0) {
    return {
      value: false,
      invalid: `TRUST_PROXY 값이 올바르지 않습니다: ${bad.join(', ') || raw} — 앞단 프록시 수(예: 1) 또는 프록시 IP/CIDR 목록(예: 10.0.0.0/8)을 적어 주세요.`,
    };
  }
  return { value: entries.join(',') };
}

/** DATABASE_URL 의 sslmode (DATABASE_SSL 이 비어 있을 때 사용). prefer/allow/없음 → null(기본값 사용) */
function sslModeFromUrl(url: string | undefined): DatabaseSslMode | null {
  if (!url) return null;
  let mode: string | null;
  try {
    mode = new URL(url).searchParams.get('sslmode');
  } catch {
    return null;
  }
  switch (mode?.trim().toLowerCase()) {
    case 'disable':
      return 'disable';
    case 'require':
    case 'no-verify':
      return 'require';
    case 'verify-ca': // 인증서 검증을 요청했으면 더 약하게 바꾸지 않는다(호스트 이름까지 검증)
    case 'verify-full':
      return 'verify-full';
    default:
      return null;
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** process.env(또는 주어진 env) 를 읽어 설정을 만든다. 문제가 있으면 ConfigError(한국어 목록)를 던진다. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => {
      const key = String(i.path[0] ?? '');
      return `${ENV_LABEL[key] ?? key} 값이 올바르지 않습니다.`;
    });
    throw new ConfigError(problems);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const problems: string[] = [];
  const warnings: string[] = [];

  // DB — 개발/테스트에서 DATABASE_URL 과 DEV_DB 가 모두 비어 있으면 내장 개발 DB(pglite)를 쓴다
  const devDbRequested = e.DEV_DB === 'pglite' || (e.DEV_DB === undefined && !isProduction && !e.DATABASE_URL);
  if (isProduction && e.DEV_DB === 'pglite') problems.push('운영(production)에서는 DEV_DB(개발용 내장 DB)를 사용할 수 없습니다. DEV_DB 를 비워 주세요.');
  if (isProduction && !e.DATABASE_URL) problems.push('운영(production)에서는 DATABASE_URL 이 필요합니다.');
  if (!e.DATABASE_URL && !devDbRequested && !isProduction) {
    problems.push('DATABASE_URL 이 없습니다. 개발 중이라면 DEV_DB=pglite 로 설정해 내장 개발 DB를 사용하세요.');
  }
  if (e.DATABASE_URL && !/^postgres(ql)?:\/\//.test(e.DATABASE_URL)) problems.push('DATABASE_URL 은 postgres:// 로 시작해야 합니다.');

  // DB SSL — DATABASE_SSL 이 비어 있으면 DATABASE_URL 의 sslmode, 그것도 없으면 운영 require / 개발 disable
  const urlSsl = sslModeFromUrl(e.DATABASE_URL);
  if (e.DATABASE_SSL === 'disable' && urlSsl && urlSsl !== 'disable') {
    problems.push(
      'DATABASE_URL 에 sslmode(암호화 연결)를 지정했는데 DATABASE_SSL=disable 로 되어 있습니다. DATABASE_SSL 을 비우거나 require/verify-full 로 설정해 주세요.',
    );
  }
  const databaseSsl: DatabaseSslMode = e.DATABASE_SSL ?? urlSsl ?? (isProduction ? 'require' : 'disable');
  if (isProduction && e.DATABASE_URL && databaseSsl === 'disable') {
    warnings.push('운영에서 DB 연결이 암호화되지 않습니다(DATABASE_SSL=disable). DB 가 SSL 을 지원하면 require 이상으로 설정해 주세요.');
  }

  // 쿠키 · 프록시
  if (isProduction && e.COOKIE_SECURE === false) {
    problems.push('운영(production)에서는 COOKIE_SECURE=false 를 사용할 수 없습니다. 비워 두거나 true 로 설정해 주세요(HTTPS 필수).');
  }
  const trust = parseTrustProxy(e.TRUST_PROXY);
  if (trust.invalid) problems.push(trust.invalid);
  if (trust.value === true) {
    const msg =
      'TRUST_PROXY=true 는 클라이언트가 보낸 X-Forwarded-For 를 그대로 믿어 로그인 시도 제한을 우회할 수 있습니다. 앞단 프록시 수(예: TRUST_PROXY=1) 또는 프록시 IP/CIDR(예: TRUST_PROXY=10.0.0.0/8)을 적어 주세요.';
    if (isProduction) problems.push(`운영(production)에서 ${msg}`);
    else warnings.push(msg);
  }

  // 비밀키
  let jwtSecret = e.JWT_SECRET;
  let fileTokenSecret = e.FILE_TOKEN_SECRET;
  let usingDevSecrets = false;
  if (isProduction) {
    if (!jwtSecret) problems.push('운영(production)에서는 JWT_SECRET 이 필요합니다.');
    if (!fileTokenSecret) problems.push('운영(production)에서는 FILE_TOKEN_SECRET 이 필요합니다.');
    if (jwtSecret?.startsWith('dev-only') || fileTokenSecret?.startsWith('dev-only')) {
      problems.push('운영(production)에서 개발용 비밀키(dev-only…)를 사용할 수 없습니다. 새 임의 값으로 바꿔 주세요.');
    }
  } else {
    if (!jwtSecret) {
      jwtSecret = DEV_JWT_SECRET;
      usingDevSecrets = true;
    }
    if (!fileTokenSecret) {
      fileTokenSecret = DEV_FILE_TOKEN_SECRET;
      usingDevSecrets = true;
    }
    if (jwtSecret.startsWith('dev-only') || fileTokenSecret.startsWith('dev-only')) usingDevSecrets = true;
  }
  if (jwtSecret && jwtSecret.length < 32) problems.push('JWT_SECRET 은 32자 이상이어야 합니다.');
  if (fileTokenSecret && fileTokenSecret.length < 32) problems.push('FILE_TOKEN_SECRET 은 32자 이상이어야 합니다.');
  if (isProduction && jwtSecret && fileTokenSecret && jwtSecret === fileTokenSecret) {
    problems.push('JWT_SECRET 과 FILE_TOKEN_SECRET 은 서로 다른 값이어야 합니다.');
  }

  // CORS
  const origins = e.CORS_ORIGINS.length > 0 ? e.CORS_ORIGINS : isProduction ? [] : ['http://localhost:8081'];
  for (const o of origins) {
    if (o === '*') problems.push("CORS_ORIGINS 에 '*' 는 사용할 수 없습니다. 웹 앱 주소를 정확히 적어 주세요.");
    else if (!isHttpUrl(o)) problems.push(`CORS_ORIGINS 의 주소 형식이 올바르지 않습니다: ${o}`);
  }

  // 저장소
  if (e.STORAGE_DRIVER === 's3' && !e.S3_BUCKET) problems.push('STORAGE_DRIVER=s3 이면 S3_BUCKET 이 필요합니다.');
  if (e.S3_PUBLIC_BASE_URL && !isHttpsUrl(e.S3_PUBLIC_BASE_URL)) problems.push('S3_PUBLIC_BASE_URL 은 https:// 주소여야 합니다.');
  if (e.PUBLIC_BASE_URL && !isHttpUrl(e.PUBLIC_BASE_URL)) problems.push('PUBLIC_BASE_URL 은 http(s):// 주소여야 합니다.');
  for (const p of e.LEGACY_IMAGE_URL_PREFIXES) {
    if (!isHttpsUrl(p)) problems.push(`LEGACY_IMAGE_URL_PREFIXES 는 https:// 주소만 허용합니다: ${p}`);
  }
  const keyPrefix = e.S3_KEY_PREFIX.replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9._\-/]+$/.test(keyPrefix) || keyPrefix.split('/').some((s) => s === '..' || s === '')) {
    problems.push('S3_KEY_PREFIX 형식이 올바르지 않습니다(영문·숫자·/·-·_·. 만 사용).');
  }
  if (isProduction && e.STORAGE_DRIVER === 'local') {
    warnings.push('운영에서 로컬 저장소(STORAGE_DRIVER=local)를 사용하면 관리자 화면에서 사진이 보이지 않습니다.');
  }

  // 회원가입 — REGISTER_ROLE_ID: 없으면 R0004, 빈 값이면 NULL, 그 외 공백 없는 5자 이하
  let registerRoleId: string | null = DEFAULT_REGISTER_ROLE_ID;
  if (e.REGISTER_ROLE_ID !== undefined) {
    const role = e.REGISTER_ROLE_ID.trim();
    if (role === '') registerRoleId = null;
    else if (role.length > ROLE_ID_MAX_LENGTH || /\s/.test(role)) {
      problems.push(
        `REGISTER_ROLE_ID 는 공백 없이 ${ROLE_ID_MAX_LENGTH}자 이하여야 합니다(sys_role_mng 의 역할 코드, 예: R0004). 비워 두면 역할 없이(NULL) 저장합니다.`,
      );
    } else registerRoleId = role;
  }
  if (e.SELF_REGISTRATION_ENABLED && registerRoleId === null) {
    warnings.push('REGISTER_ROLE_ID 가 비어 있어 앱에서 가입 신청한 계정의 역할(role_id)이 NULL 로 저장됩니다. 관리자 화면에서 역할을 지정해 주세요.');
  }

  if (problems.length > 0) throw new ConfigError(problems);

  const config: AppConfig = {
    env: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    database: {
      url: e.DATABASE_URL ?? null,
      ssl: databaseSsl,
    },
    devDb: {
      enabled: !e.DATABASE_URL && devDbRequested,
      dir: e.DEV_DB_DIR,
    },
    auth: {
      jwtSecret: jwtSecret as string,
      fileTokenSecret: fileTokenSecret as string,
      accessTtlMin: e.ACCESS_TOKEN_TTL_MIN,
      refreshTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
      cookieSecure: e.COOKIE_SECURE ?? isProduction,
      passwordRehashOnLogin: e.PASSWORD_REHASH_ON_LOGIN,
      usingDevSecrets,
      allowDevSecrets: e.ALLOW_DEV_SECRETS,
      loginIpMaxPerMin: e.LOGIN_IP_MAX_PER_MIN,
    },
    cors: { origins: origins.map(stripTrailingSlash) },
    trustProxy: trust.value,
    publicBaseUrl: e.PUBLIC_BASE_URL ? stripTrailingSlash(e.PUBLIC_BASE_URL) : null,
    storage: {
      driver: e.STORAGE_DRIVER,
      localDir: e.LOCAL_STORAGE_DIR,
      keyPrefix,
      s3: {
        bucket: e.S3_BUCKET ?? null,
        region: e.S3_REGION,
        publicBaseUrl: e.S3_PUBLIC_BASE_URL ? stripTrailingSlash(e.S3_PUBLIC_BASE_URL) : null,
      },
    },
    legacyImageUrlPrefixes: e.LEGACY_IMAGE_URL_PREFIXES,
    photo: { maxBytes: e.PHOTO_MAX_BYTES, minLongSide: e.PHOTO_MIN_LONG_SIDE },
    features: {
      clientApprovalRequiredForEdi: e.CLIENT_APPROVAL_REQUIRED_FOR_EDI,
      medicineFeeVisible: e.MEDICINE_FEE_VISIBLE,
    },
    edi: { dealType: e.EDI_DEAL_TYPE },
    registration: {
      enabled: e.SELF_REGISTRATION_ENABLED,
      roleId: registerRoleId,
      ipMaxPer10Min: e.REGISTER_IP_MAX_PER_10MIN,
      maxPerHour: e.REGISTER_MAX_PER_HOUR,
    },
  };
  configWarnings.set(config, warnings);
  return config;
}

const configWarnings = new WeakMap<AppConfig, string[]>();

/** loadConfig 중 발견된 경고(기동은 가능) */
export function getConfigWarnings(config: AppConfig): string[] {
  const list = [...(configWarnings.get(config) ?? [])];
  if (config.auth.usingDevSecrets) list.push('개발용 비밀키(dev-only)를 사용 중입니다. 운영에서는 반드시 교체하세요.');
  return list;
}

/**
 * 서버 기동(index.ts) 전용 추가 확인 — 문제가 있으면 기동하지 않는다.
 * db:check·db:migrate·cleanup:uploads 스크립트는 DBA 가 개발 .env 로 실제 DB 에 실행할 수 있어야 하므로 적용하지 않는다.
 */
export function serverStartProblems(config: AppConfig): string[] {
  const problems: string[] = [];
  if (config.database.url && !config.isProduction && config.auth.usingDevSecrets && !config.auth.allowDevSecrets) {
    problems.push(
      '실제 DB(DATABASE_URL)에 개발용 비밀키(dev-only…)로 서버를 시작할 수 없습니다. 운영 서버라면 .env 에 NODE_ENV=production 과 새 JWT_SECRET·FILE_TOKEN_SECRET 을 설정하세요. (내 PC 의 개발용 DB 라면 ALLOW_DEV_SECRETS=true)',
    );
  }
  return problems;
}

/** 로그용 설정 요약 (비밀값·DB 주소 비밀번호 제외) */
export function describeConfig(config: AppConfig): Record<string, unknown> {
  let db = '개발용 내장 DB(PGlite)';
  if (config.database.url) {
    try {
      const u = new URL(config.database.url);
      db = `${u.hostname}:${u.port || '5432'}${u.pathname} (ssl=${config.database.ssl})`;
    } catch {
      db = '(주소 해석 불가)';
    }
  }
  return {
    env: config.env,
    listen: `${config.host}:${config.port}`,
    db,
    storage: config.storage.driver === 's3' ? `s3://${config.storage.s3.bucket}/${config.storage.keyPrefix}` : `local:${config.storage.localDir}`,
    corsOrigins: config.cors.origins,
    cookieSecure: config.auth.cookieSecure,
    trustProxy: config.trustProxy,
    loginIpMaxPerMin: config.auth.loginIpMaxPerMin,
    clientApprovalRequiredForEdi: config.features.clientApprovalRequiredForEdi,
    medicineFeeVisible: config.features.medicineFeeVisible,
    ediDealType: config.edi.dealType,
    selfRegistration: config.registration.enabled,
    registerRoleId: config.registration.roleId,
    registerIpMaxPer10Min: config.registration.ipMaxPer10Min,
    registerMaxPerHour: config.registration.maxPerHour,
  };
}
