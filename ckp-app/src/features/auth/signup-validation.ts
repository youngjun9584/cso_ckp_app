/**
 * 회원가입 입력 검증 — 서버(POST /v1/auth/register, GET /v1/auth/check-id)와 같은 규칙의 순수 함수.
 * 화면(SignupScreen)과 샘플 API(lib/api/sample)가 함께 쓴다. 규칙을 바꾸면 서버도 같이 바꾼다.
 *
 * - 아이디(usr_id): 앞뒤 공백 제거 후 2~20자, 한글·영문·숫자·밑줄(_)·하이픈(-)·마침표(.)만, 공백 불가.
 *   로그인은 대소문자까지 정확히 비교하지만, 가입 시 중복은 대소문자 구분 없이 확인한다(비슷한 아이디 방지).
 * - 비밀번호: 8~64자, 영문과 숫자를 모두 포함, 앞뒤 공백 불가, 아이디와 같으면 안 됨.
 * - 이름 1~20자, 휴대폰 숫자·하이픈(숫자 10~11자리, 010-1234-5678 형태로 보냄), 이메일(선택) ≤200자,
 *   회사명(선택) ≤50자, 개인정보 수집·이용 동의 필수.
 */
import type { RegisterRequest } from '@/lib/api/contract';
import { formatPhone, onlyDigits } from '@/lib/format';

export const SIGNUP_LIMITS = {
  usrIdMin: 2,
  usrIdMax: 20,
  passwordMin: 8,
  passwordMax: 64,
  nameMax: 20,
  phoneMinDigits: 10,
  phoneMaxDigits: 11,
  /** 저장 칸(phone varchar(15)) */
  phoneMax: 15,
  emailMax: 200,
  companyNameMax: 50,
} as const;

export const SIGNUP_MESSAGES = {
  usrIdRequired: '아이디를 입력해 주세요.',
  usrIdSpace: '아이디에는 공백을 넣을 수 없습니다.',
  usrIdLength: `아이디는 ${SIGNUP_LIMITS.usrIdMin}~${SIGNUP_LIMITS.usrIdMax}자로 입력해 주세요.`,
  usrIdChars: '아이디는 한글, 영문, 숫자와 밑줄(_), 하이픈(-), 마침표(.)만 사용할 수 있습니다.',
  usrIdDuplicate: '이미 사용 중인 아이디입니다.',
  usrIdAvailable: '사용할 수 있는 아이디입니다.',
  passwordRequired: '비밀번호를 입력해 주세요.',
  passwordSpace: '비밀번호 앞뒤에는 공백을 넣을 수 없습니다.',
  passwordLength: `비밀번호는 ${SIGNUP_LIMITS.passwordMin}~${SIGNUP_LIMITS.passwordMax}자로 입력해 주세요.`,
  passwordMix: '비밀번호에 영문과 숫자를 함께 넣어 주세요.',
  passwordSameAsId: '아이디와 같은 비밀번호는 사용할 수 없습니다.',
  passwordHint: `${SIGNUP_LIMITS.passwordMin}~${SIGNUP_LIMITS.passwordMax}자, 영문과 숫자를 함께 사용하세요`,
  passwordConfirmRequired: '비밀번호를 한 번 더 입력해 주세요.',
  passwordMismatch: '비밀번호가 일치하지 않습니다.',
  nameRequired: '이름을 입력해 주세요.',
  nameLength: `이름은 ${SIGNUP_LIMITS.nameMax}자 이하로 입력해 주세요.`,
  phoneRequired: '휴대폰 번호를 입력해 주세요.',
  phoneChars: '휴대폰 번호는 숫자와 하이픈(-)만 입력할 수 있습니다.',
  phoneLength: '휴대폰 번호를 정확히 입력해 주세요. (숫자 10~11자리)',
  emailFormat: '이메일 주소 형식이 올바르지 않습니다.',
  emailLength: `이메일은 ${SIGNUP_LIMITS.emailMax}자 이하로 입력해 주세요.`,
  companyNameLength: `회사명은 ${SIGNUP_LIMITS.companyNameMax}자 이하로 입력해 주세요.`,
  agreePrivacyRequired: '개인정보 수집·이용에 동의해 주세요.',
} as const;

/** 화면 입력값 (passwordConfirm 은 앱에서만 확인하고 서버로 보내지 않는다) */
export interface SignupFormValues {
  usrId: string;
  password: string;
  passwordConfirm: string;
  name: string;
  phone: string;
  email: string;
  companyName: string;
  agreePrivacy: boolean;
}

export type SignupFormField = keyof SignupFormValues;
export type SignupFormErrors = Partial<Record<SignupFormField, string>>;

/** 화면 순서 — 첫 오류 입력란으로 이동할 때 사용 */
export const SIGNUP_FIELD_ORDER: readonly SignupFormField[] = [
  'usrId',
  'password',
  'passwordConfirm',
  'name',
  'phone',
  'email',
  'companyName',
  'agreePrivacy',
];

export const EMPTY_SIGNUP_FORM: SignupFormValues = {
  usrId: '',
  password: '',
  passwordConfirm: '',
  name: '',
  phone: '',
  email: '',
  companyName: '',
  agreePrivacy: false,
};

const USR_ID_CHARS = /^[0-9A-Za-z가-힣_.-]+$/;
const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /[0-9]/;
const PHONE_CHARS = /^[0-9-]+$/;
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 서버와 같게 NFC 정규화 후 앞뒤 공백 제거 (한글 자모가 분리되어 입력되는 기기 대비) */
export const normalizeUsrId = (value: string | null | undefined): string => (value ?? '').normalize('NFC').trim();

/** 중복 비교용 키 (서버: lower(usr_id) = lower($1)) */
export const usrIdKey = (value: string | null | undefined): string => normalizeUsrId(value).toLowerCase();

export function validateUsrId(value: string | null | undefined): string | null {
  const id = normalizeUsrId(value);
  if (!id) return SIGNUP_MESSAGES.usrIdRequired;
  if (/\s/.test(id)) return SIGNUP_MESSAGES.usrIdSpace;
  if (id.length < SIGNUP_LIMITS.usrIdMin || id.length > SIGNUP_LIMITS.usrIdMax) return SIGNUP_MESSAGES.usrIdLength;
  if (!USR_ID_CHARS.test(id)) return SIGNUP_MESSAGES.usrIdChars;
  return null;
}

export function validatePassword(password: string | null | undefined, usrId: string | null | undefined): string | null {
  const pw = password ?? '';
  if (!pw) return SIGNUP_MESSAGES.passwordRequired;
  if (pw !== pw.trim()) return SIGNUP_MESSAGES.passwordSpace;
  if (pw.length < SIGNUP_LIMITS.passwordMin || pw.length > SIGNUP_LIMITS.passwordMax) return SIGNUP_MESSAGES.passwordLength;
  if (!HAS_LETTER.test(pw) || !HAS_DIGIT.test(pw)) return SIGNUP_MESSAGES.passwordMix;
  const id = normalizeUsrId(usrId);
  // 서버와 같게 대소문자를 무시하고 비교한다
  if (id && pw.toLowerCase() === id.toLowerCase()) return SIGNUP_MESSAGES.passwordSameAsId;
  return null;
}

export function validatePasswordConfirm(password: string, confirm: string): string | null {
  if (!confirm) return SIGNUP_MESSAGES.passwordConfirmRequired;
  if (password !== confirm) return SIGNUP_MESSAGES.passwordMismatch;
  return null;
}

export function validateName(value: string | null | undefined): string | null {
  const name = (value ?? '').trim();
  if (!name) return SIGNUP_MESSAGES.nameRequired;
  if (name.length > SIGNUP_LIMITS.nameMax) return SIGNUP_MESSAGES.nameLength;
  return null;
}

export function validatePhone(value: string | null | undefined): string | null {
  const phone = (value ?? '').trim();
  if (!phone) return SIGNUP_MESSAGES.phoneRequired;
  if (!PHONE_CHARS.test(phone)) return SIGNUP_MESSAGES.phoneChars;
  const digits = onlyDigits(phone);
  if (digits.length < SIGNUP_LIMITS.phoneMinDigits || digits.length > SIGNUP_LIMITS.phoneMaxDigits) {
    return SIGNUP_MESSAGES.phoneLength;
  }
  return null;
}

/** 이메일은 선택 — 비어 있으면 통과 */
export function validateEmail(value: string | null | undefined): string | null {
  const email = (value ?? '').trim();
  if (!email) return null;
  if (email.length > SIGNUP_LIMITS.emailMax) return SIGNUP_MESSAGES.emailLength;
  if (!EMAIL_FORMAT.test(email)) return SIGNUP_MESSAGES.emailFormat;
  return null;
}

/** 회사명은 선택 — 비어 있으면 통과 */
export function validateCompanyName(value: string | null | undefined): string | null {
  const name = (value ?? '').trim();
  if (name.length > SIGNUP_LIMITS.companyNameMax) return SIGNUP_MESSAGES.companyNameLength;
  return null;
}

export function validateAgreePrivacy(value: unknown): string | null {
  return value === true ? null : SIGNUP_MESSAGES.agreePrivacyRequired;
}

/** 휴대폰 번호를 저장 형태(010-1234-5678)로 */
export const formatMobilePhone = (value: string | null | undefined): string => formatPhone(value);

/** 입력 전체 검증 (오류가 없으면 빈 객체) */
export function validateSignupForm(values: SignupFormValues): SignupFormErrors {
  const errors: SignupFormErrors = {};
  const set = (field: SignupFormField, message: string | null) => {
    if (message) errors[field] = message;
  };
  set('usrId', validateUsrId(values.usrId));
  set('password', validatePassword(values.password, values.usrId));
  set('passwordConfirm', validatePasswordConfirm(values.password, values.passwordConfirm));
  set('name', validateName(values.name));
  set('phone', validatePhone(values.phone));
  set('email', validateEmail(values.email));
  set('companyName', validateCompanyName(values.companyName));
  set('agreePrivacy', validateAgreePrivacy(values.agreePrivacy));
  return errors;
}

/**
 * 서버와 같은 규칙으로 RegisterRequest 를 검증한다 (샘플 API 용). 오류가 없으면 빈 객체.
 * 입력란 이름은 서버 error.fields 와 같다 (usrId, password, name, phone, email, companyName, agreePrivacy).
 */
export function validateRegisterRequest(body: Partial<RegisterRequest> | null | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
  const set = (field: keyof RegisterRequest, message: string | null) => {
    if (message) fields[field] = message;
  };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  set('usrId', validateUsrId(str(body?.usrId)));
  set('password', validatePassword(str(body?.password), str(body?.usrId)));
  set('name', validateName(str(body?.name)));
  set('phone', validatePhone(str(body?.phone)));
  set('email', validateEmail(str(body?.email)));
  set('companyName', validateCompanyName(str(body?.companyName)));
  set('agreePrivacy', validateAgreePrivacy(body?.agreePrivacy));
  return fields;
}

export const hasSignupErrors = (errors: SignupFormErrors): boolean => Object.values(errors).some(Boolean);

export function firstSignupErrorField(errors: SignupFormErrors): SignupFormField | null {
  return SIGNUP_FIELD_ORDER.find((field) => !!errors[field]) ?? null;
}

export function isSignupFormField(key: string): key is SignupFormField {
  return (SIGNUP_FIELD_ORDER as readonly string[]).includes(key);
}

/** 한 칸이라도 입력했거나 동의에 체크했으면 true (나가기 확인용) */
export function isSignupFormDirty(values: SignupFormValues): boolean {
  return (
    values.agreePrivacy ||
    values.password.length > 0 ||
    values.passwordConfirm.length > 0 ||
    [values.usrId, values.name, values.phone, values.email, values.companyName].some((v) => v.trim().length > 0)
  );
}

/** 입력값 → POST /v1/auth/register 본문 (앞뒤 공백 정리, 이메일 소문자, 휴대폰 하이픈) */
export function toRegisterRequest(values: SignupFormValues): RegisterRequest {
  const email = values.email.trim().toLowerCase();
  const companyName = values.companyName.trim();
  return {
    usrId: normalizeUsrId(values.usrId),
    password: values.password,
    name: values.name.trim(),
    phone: formatMobilePhone(values.phone.trim()),
    email: email || null,
    companyName: companyName || null,
    agreePrivacy: values.agreePrivacy,
  };
}
