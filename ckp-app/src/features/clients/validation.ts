/**
 * 거래처 등록 입력 검증 — 서버(ckp-server/src/domain/clients/validation.ts)와 같은 규칙·문구.
 * 서버가 최종 판단하므로 여기서는 저장 전에 알 수 있는 오류를 미리 보여주는 용도다.
 */
import type { ClientCreateRequest } from '@/lib/api';
import { isValidBizNo, onlyDigits } from '@/lib/format';

/** 계약(contract.ts ClientCreateRequest) 기준 최대 길이 */
export const CLIENT_FIELD_LIMITS = {
  name: 100,
  clientType: 50,
  representative: 100,
  phone: 20,
  /** 주소 + 상세주소 합계 */
  address: 100,
  zipCode: 10,
  careCode: 50,
  dispensary: 100,
  memo: 200,
} as const;

export const CLIENT_MESSAGES = {
  nameRequired: '거래처명을 입력해 주세요.',
  nameTooLong: `거래처명은 ${CLIENT_FIELD_LIMITS.name}자 이하로 입력해 주세요.`,
  nameDuplicate: '이미 등록된 거래처명입니다.',
  clientTypeTooLong: `거래처 구분은 ${CLIENT_FIELD_LIMITS.clientType}자 이하로 입력해 주세요.`,
  bizNoChars: '사업자등록번호는 숫자와 하이픈(-)만 입력할 수 있습니다.',
  bizNoLength: '사업자등록번호 10자리를 정확히 입력해 주세요.',
  bizNoChecksum: '사업자등록번호가 유효하지 않습니다. 번호를 다시 확인해 주세요.',
  bizNoDuplicate: '이미 등록된 사업자등록번호입니다.',
  representativeTooLong: `대표자명은 ${CLIENT_FIELD_LIMITS.representative}자 이하로 입력해 주세요.`,
  phoneChars: '연락처는 숫자와 하이픈(-)만 입력할 수 있습니다.',
  phoneTooLong: `연락처는 ${CLIENT_FIELD_LIMITS.phone}자 이하로 입력해 주세요.`,
  zipCode: '우편번호는 숫자 5자리로 입력해 주세요.',
  addressTooLong: `주소와 상세주소를 합쳐 ${CLIENT_FIELD_LIMITS.address}자 이하로 입력해 주세요.`,
  careCodeTooLong: `요양기관번호는 ${CLIENT_FIELD_LIMITS.careCode}자 이하로 입력해 주세요.`,
  dispensaryTooLong: `문전약국은 ${CLIENT_FIELD_LIMITS.dispensary}자 이하로 입력해 주세요.`,
  memoTooLong: `메모는 ${CLIENT_FIELD_LIMITS.memo}자 이하로 입력해 주세요.`,
} as const;

export interface ClientFormValues {
  name: string;
  clientType: string;
  bizNo: string;
  representative: string;
  phone: string;
  zipCode: string;
  address: string;
  addressDetail: string;
  careCode: string;
  dispensary: string;
  memo: string;
}

export type ClientFormField = keyof ClientFormValues;
export type ClientFormErrors = Partial<Record<ClientFormField, string>>;

/** 화면 표시 순서 (첫 번째 오류로 이동할 때 사용) */
export const CLIENT_FORM_FIELDS: readonly ClientFormField[] = [
  'name',
  'clientType',
  'bizNo',
  'representative',
  'phone',
  'zipCode',
  'address',
  'addressDetail',
  'careCode',
  'dispensary',
  'memo',
];

export const EMPTY_CLIENT_FORM: ClientFormValues = {
  name: '',
  clientType: '',
  bizNo: '',
  representative: '',
  phone: '',
  zipCode: '',
  address: '',
  addressDetail: '',
  careCode: '',
  dispensary: '',
  memo: '',
};

export function isClientFormField(key: string): key is ClientFormField {
  return (CLIENT_FORM_FIELDS as readonly string[]).includes(key);
}

/** 서버와 같은 거래처명 정규화: 연속 공백 하나로, 앞뒤 공백 제거 */
export function normalizeClientName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** 주소 + 상세주소를 서버 저장 방식(공백 하나)으로 합친다 */
export function joinAddress(address: string, detail: string): string {
  return [address.trim(), detail.trim()].filter(Boolean).join(' ');
}

/** 사업자등록번호 형식·검증번호 확인. 비어 있으면 null(선택 항목) */
export function validateBizNoInput(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  if (!/^[\d\-\s]+$/.test(t)) return CLIENT_MESSAGES.bizNoChars;
  const digits = onlyDigits(t);
  if (digits.length !== 10) return CLIENT_MESSAGES.bizNoLength;
  if (!isValidBizNo(digits)) return CLIENT_MESSAGES.bizNoChecksum;
  return null;
}

function tooLong(value: string, max: number): boolean {
  return value.trim().length > max;
}

export interface ClientFormOptions {
  /** meta.features.clientTypeField — false 면 거래처 구분을 검사·전송하지 않는다 */
  clientTypeField: boolean;
}

export function validateClientForm(values: ClientFormValues, options: ClientFormOptions): ClientFormErrors {
  const errors: ClientFormErrors = {};

  const name = normalizeClientName(values.name);
  if (!name) errors.name = CLIENT_MESSAGES.nameRequired;
  else if (name.length > CLIENT_FIELD_LIMITS.name) errors.name = CLIENT_MESSAGES.nameTooLong;

  if (options.clientTypeField && tooLong(values.clientType, CLIENT_FIELD_LIMITS.clientType)) {
    errors.clientType = CLIENT_MESSAGES.clientTypeTooLong;
  }

  const bizNoError = validateBizNoInput(values.bizNo);
  if (bizNoError) errors.bizNo = bizNoError;

  if (tooLong(values.representative, CLIENT_FIELD_LIMITS.representative)) {
    errors.representative = CLIENT_MESSAGES.representativeTooLong;
  }

  const phone = values.phone.trim();
  if (phone) {
    if (!/^[0-9-]+$/.test(phone) || !/[0-9]/.test(phone)) errors.phone = CLIENT_MESSAGES.phoneChars;
    else if (phone.length > CLIENT_FIELD_LIMITS.phone) errors.phone = CLIENT_MESSAGES.phoneTooLong;
  }

  const zip = values.zipCode.trim();
  if (zip && (!(/^\d{5}$/.test(zip) || /^\d{3}-?\d{3}$/.test(zip)) || zip.length > CLIENT_FIELD_LIMITS.zipCode)) {
    errors.zipCode = CLIENT_MESSAGES.zipCode;
  }

  if (joinAddress(values.address, values.addressDetail).length > CLIENT_FIELD_LIMITS.address) {
    // 서버는 두 칸 모두에 같은 문구를 준다. 화면에서는 한 칸에만 보여준다(ClientCreateScreen).
    errors.address = CLIENT_MESSAGES.addressTooLong;
    if (values.addressDetail.trim()) errors.addressDetail = CLIENT_MESSAGES.addressTooLong;
  }

  if (tooLong(values.careCode, CLIENT_FIELD_LIMITS.careCode)) errors.careCode = CLIENT_MESSAGES.careCodeTooLong;
  if (tooLong(values.dispensary, CLIENT_FIELD_LIMITS.dispensary)) errors.dispensary = CLIENT_MESSAGES.dispensaryTooLong;
  if (tooLong(values.memo, CLIENT_FIELD_LIMITS.memo)) errors.memo = CLIENT_MESSAGES.memoTooLong;

  return errors;
}

export function hasErrors(errors: ClientFormErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/** 첫 번째 오류 입력란 (화면 순서 기준) */
export function firstErrorField(errors: ClientFormErrors): ClientFormField | null {
  return CLIENT_FORM_FIELDS.find((field) => !!errors[field]) ?? null;
}

const orNull = (value: string): string | null => {
  const t = value.trim();
  return t ? t : null;
};

export function toClientCreateRequest(values: ClientFormValues, options: ClientFormOptions): ClientCreateRequest {
  const body: ClientCreateRequest = {
    name: normalizeClientName(values.name),
    bizNo: orNull(values.bizNo),
    representative: orNull(values.representative),
    phone: orNull(values.phone),
    zipCode: orNull(values.zipCode),
    address: orNull(values.address),
    addressDetail: orNull(values.addressDetail),
    careCode: orNull(values.careCode),
    dispensary: orNull(values.dispensary),
    memo: orNull(values.memo),
  };
  if (options.clientTypeField) body.clientType = orNull(values.clientType);
  return body;
}

/** 하나라도 입력했으면 true (나가기 확인용) */
export function isClientFormDirty(values: ClientFormValues): boolean {
  return CLIENT_FORM_FIELDS.some((field) => values[field].trim().length > 0);
}
