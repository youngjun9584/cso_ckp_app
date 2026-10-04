/**
 * 거래처 등록 입력 검증 (DESIGN §2.2, §5.5) — 필드별 한국어 메시지를 한 번에 모아 400 VALIDATION_FAILED 로 돌려준다.
 * 길이 제한은 계약 값과 실제 DB 컬럼 길이(capabilities.columns) 중 작은 값을 쓴다(DB 오류 방지).
 */
import { z } from 'zod';
import type { Capabilities } from '../../db/schema-check.js';
import { checkBizNo } from '../../lib/bizno.js';
import { AppError } from '../../lib/errors.js';
import { koreanErrorMap } from '../../lib/validation.js';

/** 계약(contract.ts ClientCreateRequest) 기준 최대 길이 */
export const CLIENT_CONTRACT_LIMITS = {
  name: 100,
  clientType: 50,
  representative: 100,
  phone: 20,
  address: 100,
  zipCode: 10,
  careCode: 50,
  dispensary: 100,
  memo: 200,
  bizNo: 100,
} as const;

export type ClientFieldLimits = { -readonly [K in keyof typeof CLIENT_CONTRACT_LIMITS]: number };

const COLUMN_OF: Record<keyof ClientFieldLimits, string> = {
  name: 'hospital',
  clientType: 'hospital_type',
  representative: 'doctor_name',
  phone: 'phone',
  address: 'address',
  zipCode: 'zip_code',
  careCode: 'care_code',
  dispensary: 'dispensary',
  memo: 'ee',
  bizNo: 'cpy_number',
};

export function clientFieldLimits(capabilities: Capabilities): ClientFieldLimits {
  const cols = capabilities.columns.mannager_by_hospital ?? {};
  const out = {} as ClientFieldLimits;
  for (const key of Object.keys(CLIENT_CONTRACT_LIMITS) as (keyof ClientFieldLimits)[]) {
    const dbMax = cols[COLUMN_OF[key]]?.maxLength;
    const apiMax = CLIENT_CONTRACT_LIMITS[key];
    out[key] = dbMax && dbMax > 0 ? Math.min(dbMax, apiMax) : apiMax;
  }
  return out;
}

export const CLIENT_MESSAGES = {
  nameRequired: '거래처명을 입력해 주세요.',
  nameTooLong: (n: number) => `거래처명은 ${n}자 이하로 입력해 주세요.`,
  clientTypeTooLong: (n: number) => `거래처 구분은 ${n}자 이하로 입력해 주세요.`,
  representativeTooLong: (n: number) => `대표자명은 ${n}자 이하로 입력해 주세요.`,
  phoneChars: '연락처는 숫자와 하이픈(-)만 입력할 수 있습니다.',
  phoneTooLong: (n: number) => `연락처는 ${n}자 이하로 입력해 주세요.`,
  zipCode: '우편번호는 숫자 5자리로 입력해 주세요.',
  addressTooLong: (n: number) => `주소와 상세주소를 합쳐 ${n}자 이하로 입력해 주세요.`,
  careCodeTooLong: (n: number) => `요양기관번호는 ${n}자 이하로 입력해 주세요.`,
  dispensaryTooLong: (n: number) => `문전약국은 ${n}자 이하로 입력해 주세요.`,
  memoTooLong: (n: number) => `메모는 ${n}자 이하로 입력해 주세요.`,
  invalidType: '입력 형식이 올바르지 않습니다.',
  general: '입력한 내용을 확인해 주세요.',
} as const;

/** 거래처명 정규화(표시·저장용): 연속 공백을 하나로, 앞뒤 공백 제거 */
export function normalizeClientName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** 선택 문자열: 문자열이 아니면 형식 오류, trim 후 빈 값은 null, 길이 초과는 지정 메시지 */
function optionalString(max: number, tooLong: string) {
  return z
    .string({ error: CLIENT_MESSAGES.invalidType })
    .nullish()
    .transform((v, ctx) => {
      const t = v?.trim() ?? '';
      if (t.length > max) {
        ctx.addIssue({ code: 'custom', message: tooLong });
        return z.NEVER;
      }
      return t === '' ? null : t;
    });
}

function nameSchema(max: number) {
  return z.string({ error: CLIENT_MESSAGES.nameRequired }).transform((v, ctx) => {
    const t = normalizeClientName(v);
    if (!t) {
      ctx.addIssue({ code: 'custom', message: CLIENT_MESSAGES.nameRequired });
      return z.NEVER;
    }
    if (t.length > max) {
      ctx.addIssue({ code: 'custom', message: CLIENT_MESSAGES.nameTooLong(max) });
      return z.NEVER;
    }
    return t;
  });
}

export interface ValidBizNo {
  digits: string;
  /** 저장값: 'XXX-XX-XXXXX' (컬럼이 너무 짧으면 숫자 10자리) */
  stored: string;
}

function bizNoSchema(max: number) {
  return z
    .string({ error: CLIENT_MESSAGES.invalidType })
    .nullish()
    .transform((v, ctx): ValidBizNo | null => {
      const t = v?.trim() ?? '';
      if (!t) return null;
      const check = checkBizNo(t);
      if (!check.ok) {
        ctx.addIssue({ code: 'custom', message: check.message });
        return z.NEVER;
      }
      return { digits: check.digits, stored: check.formatted.length <= max ? check.formatted : check.digits };
    });
}

function phoneSchema(max: number) {
  return z
    .string({ error: CLIENT_MESSAGES.invalidType })
    .nullish()
    .transform((v, ctx) => {
      const t = v?.trim() ?? '';
      if (!t) return null;
      if (!/^[0-9-]+$/.test(t) || !/[0-9]/.test(t)) {
        ctx.addIssue({ code: 'custom', message: CLIENT_MESSAGES.phoneChars });
        return z.NEVER;
      }
      if (t.length > max) {
        ctx.addIssue({ code: 'custom', message: CLIENT_MESSAGES.phoneTooLong(max) });
        return z.NEVER;
      }
      return t;
    });
}

function zipCodeSchema(max: number) {
  return z
    .string({ error: CLIENT_MESSAGES.invalidType })
    .nullish()
    .transform((v, ctx) => {
      const t = v?.trim() ?? '';
      if (!t) return null;
      // 현행 5자리, 구 우편번호 6자리(123-456 형식 포함) 허용
      if (!(/^\d{5}$/.test(t) || /^\d{3}-?\d{3}$/.test(t)) || t.length > max) {
        ctx.addIssue({ code: 'custom', message: CLIENT_MESSAGES.zipCode });
        return z.NEVER;
      }
      return t;
    });
}

export interface ValidClientCreate {
  name: string;
  clientType: string | null;
  bizNo: ValidBizNo | null;
  representative: string | null;
  phone: string | null;
  /** address + ' ' + addressDetail (빈 값 제외) */
  address: string | null;
  zipCode: string | null;
  careCode: string | null;
  dispensary: string | null;
  memo: string | null;
}

/**
 * POST /v1/clients 본문 검증. 모든 필드를 따로 검사해 오류를 한 번에 모은다.
 * 실패 시 AppError(VALIDATION_FAILED, fields) — 필드가 하나면 그 메시지를, 여러 개면 일반 메시지를 message 로 쓴다.
 */
export function validateClientCreate(body: unknown, limits: ClientFieldLimits): ValidClientCreate {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('VALIDATION_FAILED', CLIENT_MESSAGES.general);
  }
  const raw = body as Record<string, unknown>;
  const fields: Record<string, string> = {};

  function take<T>(key: string, schema: z.ZodType<T>): T | null {
    const r = schema.safeParse(raw[key], { error: koreanErrorMap });
    if (r.success) return r.data;
    if (!(key in fields)) fields[key] = r.error.issues[0]?.message ?? CLIENT_MESSAGES.general;
    return null;
  }

  const name = take('name', nameSchema(limits.name));
  const clientType = take('clientType', optionalString(limits.clientType, CLIENT_MESSAGES.clientTypeTooLong(limits.clientType)));
  const bizNo = take('bizNo', bizNoSchema(limits.bizNo));
  const representative = take('representative', optionalString(limits.representative, CLIENT_MESSAGES.representativeTooLong(limits.representative)));
  const phone = take('phone', phoneSchema(limits.phone));
  const zipCode = take('zipCode', zipCodeSchema(limits.zipCode));
  const careCode = take('careCode', optionalString(limits.careCode, CLIENT_MESSAGES.careCodeTooLong(limits.careCode)));
  const dispensary = take('dispensary', optionalString(limits.dispensary, CLIENT_MESSAGES.dispensaryTooLong(limits.dispensary)));
  const memo = take('memo', optionalString(limits.memo, CLIENT_MESSAGES.memoTooLong(limits.memo)));

  // 주소 + 상세주소는 한 컬럼(address)에 공백 하나로 합쳐 저장한다
  const addressTooLong = CLIENT_MESSAGES.addressTooLong(limits.address);
  const addressPart = take('address', optionalString(2000, addressTooLong));
  const detailPart = take('addressDetail', optionalString(2000, addressTooLong));
  const joined = [addressPart, detailPart].filter((s): s is string => Boolean(s)).join(' ');
  if (joined.length > limits.address) {
    if (!('address' in fields)) fields.address = addressTooLong;
    if (detailPart && !('addressDetail' in fields)) fields.addressDetail = addressTooLong;
  }

  const keys = Object.keys(fields);
  if (keys.length > 0 || name === null) {
    const message = keys.length === 1 ? (fields[keys[0] as string] as string) : CLIENT_MESSAGES.general;
    throw new AppError('VALIDATION_FAILED', message, { fields });
  }

  return {
    name,
    clientType,
    bizNo,
    representative,
    phone,
    address: joined === '' ? null : joined,
    zipCode,
    careCode,
    dispensary,
    memo,
  };
}
