/**
 * 앱 회원가입(승인 대기 신청) — contract '회원가입' 절
 *
 * 기존 업무 방식(참고 Next.js·구 앱)과 같게 public.sys_app_usr_mng 에 apr_yn='N'(승인 대기)으로 등록하고,
 * 관리자가 기존 관리자 화면(앱 회원 관리)에서 apr_yn='Y' 로 승인해야 로그인할 수 있다(로그인은 'N' 이면 '관리자 승인 대기중입니다.').
 *
 *   const input = validateRegistration(request.body);          // 400 VALIDATION_FAILED(fields)
 *   if (await isUserIdTaken(db, input.usrId)) throw duplicateUserIdError();
 *   const hash = await hashPassword(input.password);            // bcrypt cost 10 (lib/password.ts 동시 실행 제한)
 *   await insertPendingUser(db, input, { passwordHash: hash, roleId, joinYmd });   // 409 DUPLICATE_USER_ID
 *
 * 규칙
 *   - 아이디(usr_id): NFC 정규화 + trim, 2~20자, 한글·영문·숫자·_·-·.·공백(가운데)만.
 *     로그인은 정확히 일치(대소문자 구분)하지만, 비슷해 보이는 계정을 막기 위해 중복은 대소문자·앞뒤 공백을 무시하고 판단한다
 *     (lower(btrim(usr_id)) = lower($1)). 같은 아이디의 동시 가입은 advisory lock 으로 직렬화하고, PK 충돌(23505)도 409 로 바꾼다.
 *   - 비밀번호: 4~64자, 앞뒤 공백 불가. bcrypt 로만 저장(MD5 금지).
 *   - 저장 컬럼은 명시한 목록만: usr_id, usr_pwd, usr_nam, phone, email, cpy_nam, apr_yn('N'), join_ymd(KST 오늘), role_id.
 *     요청 본문의 다른 항목(aprYn, roleId 등)은 무시한다. 계좌·신분증·사진 정보는 받지 않는다.
 */
import { z } from 'zod';
import type { Db, Queryable } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { koreanErrorMap, zodFields } from '../../lib/validation.js';

export const USER_ID_MIN_LENGTH = 2;
export const USER_ID_MAX_LENGTH = 20;
export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 64;
export const NAME_MAX_LENGTH = 20;
export const EMAIL_MAX_LENGTH = 200;
export const COMPANY_NAME_MAX_LENGTH = 50;
/** 입력 원문(하이픈 포함) 최대 길이 — 저장 형식은 최대 13자(010-1234-5678) */
const PHONE_INPUT_MAX_LENGTH = 20;

export const REGISTER_MESSAGES = {
  idAvailable: '사용할 수 있는 아이디입니다.',
  idTaken: '이미 사용 중인 아이디입니다.',
  registered: '가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.',
} as const;

const MSG = {
  idRequired: '아이디를 입력해 주세요.',
  idType: '아이디 형식이 올바르지 않습니다.',
  idLength: `아이디는 ${USER_ID_MIN_LENGTH}~${USER_ID_MAX_LENGTH}자로 입력해 주세요.`,
  idChars: '아이디는 한글, 영문, 숫자, 공백, 밑줄(_), 하이픈(-), 마침표(.)만 사용할 수 있습니다.',
  pwRequired: '비밀번호를 입력해 주세요.',
  pwType: '비밀번호 형식이 올바르지 않습니다.',
  pwSpace: '비밀번호 앞뒤에는 공백을 넣을 수 없습니다.',
  pwLength: `비밀번호는 ${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH}자로 입력해 주세요.`,
  nameRequired: '이름을 입력해 주세요.',
  nameLength: `이름은 ${NAME_MAX_LENGTH}자 이하로 입력해 주세요.`,
  nameChars: '이름에 사용할 수 없는 문자가 있습니다.',
  phoneRequired: '휴대폰 번호를 입력해 주세요.',
  phoneChars: '휴대폰 번호는 숫자와 하이픈(-)만 입력해 주세요.',
  phoneDigits: '휴대폰 번호는 숫자 10~11자리로 입력해 주세요.',
  emailFormat: '이메일 형식이 올바르지 않습니다.',
  emailLength: `이메일은 ${EMAIL_MAX_LENGTH}자 이하로 입력해 주세요.`,
  companyType: '회사명 형식이 올바르지 않습니다.',
  companyLength: `회사명은 ${COMPANY_NAME_MAX_LENGTH}자 이하로 입력해 주세요.`,
  companyChars: '회사명에 사용할 수 없는 문자가 있습니다.',
  agreePrivacy: '개인정보 수집·이용에 동의해 주세요.',
} as const;

const USER_ID_RE = /^[가-힣A-Za-z0-9_. -]+$/;
const CONTROL_RE = /\p{Cc}/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 누락(undefined/null)이면 required, 그 외 타입 오류면 type 문구 */
function typeError(required: string, type: string) {
  return (issue: { input?: unknown }) => (issue.input === undefined || issue.input === null ? required : type);
}

function userIdProblem(id: string): string | null {
  if (id.length === 0) return MSG.idRequired;
  if (id.length < USER_ID_MIN_LENGTH || id.length > USER_ID_MAX_LENGTH) return MSG.idLength;
  if (!USER_ID_RE.test(id)) return MSG.idChars;
  return null;
}

function passwordProblem(pw: string): string | null {
  if (pw.length === 0) return MSG.pwRequired;
  if (pw !== pw.trim()) return MSG.pwSpace;
  if (pw.length < PASSWORD_MIN_LENGTH || pw.length > PASSWORD_MAX_LENGTH) return MSG.pwLength;
  return null;
}

/** 숫자만(10~11자리) → 저장 형식. 11자리 3-4-4, 10자리 02 로 시작하면 2-4-4, 그 외 3-3-4 */
export function formatPhone(digits: string): string {
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.startsWith('02')) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** 아이디: NFC + trim 후 형식 확인 (check-id 쿼리와 가입 본문 공통) */
export const userIdSchema = z.string({ error: typeError(MSG.idRequired, MSG.idType) }).transform((raw, ctx) => {
  const id = raw.normalize('NFC').trim();
  const problem = userIdProblem(id);
  if (problem) {
    ctx.addIssue({ code: 'custom', message: problem });
    return z.NEVER;
  }
  return id;
});

const passwordSchema = z.string({ error: typeError(MSG.pwRequired, MSG.pwType) }).superRefine((pw, ctx) => {
  const problem = passwordProblem(pw);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

const nameSchema = z.string({ error: typeError(MSG.nameRequired, MSG.nameRequired) }).transform((raw, ctx) => {
  const name = raw.normalize('NFC').trim();
  const problem = name.length === 0 ? MSG.nameRequired : name.length > NAME_MAX_LENGTH ? MSG.nameLength : CONTROL_RE.test(name) ? MSG.nameChars : null;
  if (problem) {
    ctx.addIssue({ code: 'custom', message: problem });
    return z.NEVER;
  }
  return name;
});

const phoneSchema = z.string({ error: typeError(MSG.phoneRequired, MSG.phoneChars) }).transform((raw, ctx) => {
  const text = raw.trim();
  let problem: string | null = null;
  if (text.length === 0) problem = MSG.phoneRequired;
  else if (!/^[0-9-]+$/.test(text) || text.length > PHONE_INPUT_MAX_LENGTH) problem = MSG.phoneChars;
  const digits = text.replace(/-/g, '');
  if (!problem && (digits.length < 10 || digits.length > 11)) problem = MSG.phoneDigits;
  if (problem) {
    ctx.addIssue({ code: 'custom', message: problem });
    return z.NEVER;
  }
  return formatPhone(digits);
});

/** 선택: 비우면 null. trim + 소문자로 저장 */
const emailSchema = z
  .string({ error: MSG.emailFormat })
  .nullish()
  .transform((raw, ctx) => {
    const email = (raw ?? '').trim().toLowerCase();
    if (email === '') return null;
    const problem = email.length > EMAIL_MAX_LENGTH ? MSG.emailLength : !EMAIL_RE.test(email) || CONTROL_RE.test(email) ? MSG.emailFormat : null;
    if (problem) {
      ctx.addIssue({ code: 'custom', message: problem });
      return z.NEVER;
    }
    return email;
  });

/** 선택: 비우면 null */
const companyNameSchema = z
  .string({ error: MSG.companyType })
  .nullish()
  .transform((raw, ctx) => {
    const name = (raw ?? '').normalize('NFC').trim();
    if (name === '') return null;
    const problem = name.length > COMPANY_NAME_MAX_LENGTH ? MSG.companyLength : CONTROL_RE.test(name) ? MSG.companyChars : null;
    if (problem) {
      ctx.addIssue({ code: 'custom', message: problem });
      return z.NEVER;
    }
    return name;
  });

/** z.object 는 모르는 키를 버린다(aprYn·roleId 등 대량 할당 방지) — strictObject 로 바꾸지 말 것 */
const RegisterSchema = z.object({
  usrId: userIdSchema,
  password: passwordSchema,
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema,
  companyName: companyNameSchema,
  agreePrivacy: z.literal(true, { error: MSG.agreePrivacy }),
});

export const CheckUserIdQuery = z.object({ usrId: userIdSchema });

export interface ValidRegistration {
  usrId: string;
  password: string;
  name: string;
  /** 저장 형식 (예: 010-1234-5678) */
  phone: string;
  /** trim + 소문자, 없으면 null */
  email: string | null;
  companyName: string | null;
}

function fail(fields: Record<string, string>): never {
  const keys = Object.keys(fields);
  const message = keys.length === 1 ? (fields[keys[0] as string] as string) : '입력한 내용을 확인해 주세요.';
  throw new AppError('VALIDATION_FAILED', message, { fields });
}

/** 가입 본문 검증 — 실패하면 AppError(VALIDATION_FAILED, fields: usrId·password·name·phone·email·companyName·agreePrivacy) */
export function validateRegistration(input: unknown): ValidRegistration {
  const parsed = RegisterSchema.safeParse(input, { error: koreanErrorMap });
  const fields: Record<string, string> = parsed.success ? {} : zodFields(parsed.error);
  delete fields._; // 본문 자체가 객체가 아닌 경우(필드 없음)

  if (!parsed.success || Object.keys(fields).length > 0) fail(fields);
  const d = parsed.data;
  return { usrId: d.usrId, password: d.password, name: d.name, phone: d.phone, email: d.email, companyName: d.companyName };
}

export function duplicateUserIdError(): AppError {
  return new AppError('DUPLICATE_USER_ID', REGISTER_MESSAGES.idTaken, { fields: { usrId: REGISTER_MESSAGES.idTaken } });
}

/** 같은 아이디(대소문자·앞뒤 공백 무시)가 이미 있는지 */
export async function isUserIdTaken(q: Queryable, usrId: string): Promise<boolean> {
  const { rows } = await q.query<{ taken: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM public.sys_app_usr_mng WHERE lower(btrim(usr_id)) = lower($1)) AS taken',
    [usrId],
  );
  return rows[0]?.taken === true;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

export interface PendingUserValues {
  /** bcrypt 해시 (lib/password.ts hashPassword) */
  passwordHash: string;
  /** REGISTER_ROLE_ID (null → NULL) */
  roleId: string | null;
  /** 'YYYY-MM-DD' (KST 오늘, lib/kst.ts todayKst(clock.now())) */
  joinYmd: string;
}

/**
 * 승인 대기(apr_yn='N') 계정 등록. 같은 아이디(소문자 기준)의 동시 요청은 advisory lock 으로 직렬화한 뒤 다시 확인한다.
 * 이미 있으면(또는 PK 충돌 23505) 409 DUPLICATE_USER_ID.
 */
export async function insertPendingUser(db: Db, input: ValidRegistration, values: PendingUserValues): Promise<void> {
  try {
    await db.tx(async (q) => {
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ckp_app:register:${input.usrId.toLowerCase()}`]);
      if (await isUserIdTaken(q, input.usrId)) throw duplicateUserIdError();
      await q.query(
        `INSERT INTO public.sys_app_usr_mng (usr_id, usr_pwd, usr_nam, phone, email, cpy_nam, apr_yn, join_ymd, role_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'N', $7::date, $8)`,
        [input.usrId, values.passwordHash, input.name, input.phone, input.email, input.companyName, values.joinYmd, values.roleId],
      );
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateUserIdError();
    throw err;
  }
}
