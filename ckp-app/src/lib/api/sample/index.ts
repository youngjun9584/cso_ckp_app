/**
 * 샘플 CkpApi — 서버 없이 앱 안의 메모리 데이터로 동작한다 (DESIGN §3.8, §6.4).
 * - 로그인: ckp_demo / demo1234 (승인 대기 ckp_pending, 접속 차단 ckp_blocked — 비밀번호 동일)
 * - 150~500ms 지연, 서버와 같은 검증·오류 코드·한국어 메시지
 * - 업로드: 진행률 흉내, 계정 화면 토글로 실패 흉내, 같은 clientPhotoId 는 reused
 * - 제출: Idempotency-Key 재요청은 replayed, 같은 키·다른 내용은 409
 * - 회원가입: 서버와 같은 검증(features/auth/signup-validation), 새 계정은 승인 대기(N)라 로그인하면 승인 대기 안내가 나온다
 * 저장 내용은 앱을 다시 시작하면 사라진다(로그인 상태만 native SecureStore / web sessionStorage 에 유지).
 */
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { CkpApi, RequestOptions, UploadFile, UploadProgressHandler } from '../client';
import {
  API_VERSION,
  type AuthTokensResponse,
  type AuthUser,
  type ClientCreateRequest,
  type ClientDetail,
  type ClientSummary,
  type EdiSubmissionDetail,
  type EdiSubmissionSummary,
  type EdiUpload,
  type MedicineDetail,
  type MedicineSummary,
  type NoticeDetail,
  type NoticeSummary,
  type Paged,
} from '../contract';
import { DEFAULT_EDI_LIMITS, DEFAULT_FEATURES } from '../defaults';
import { ApiError, type ApiClientErrorCode } from '../errors';
import { buildSampleClients } from './data-clients';
import { buildMonthOptions, buildSampleSubmissions, countStatuses, monthLabelFor } from './data-edi';
import { SAMPLE_MEDICINES, medicineSortKey } from './data-medicines';
import { SAMPLE_NOTICES } from './data-notices';
import { sampleSettings } from './settings';
import {
  SIGNUP_MESSAGES,
  formatMobilePhone,
  normalizeUsrId,
  usrIdKey,
  validateRegisterRequest,
  validateUsrId,
} from '@/features/auth/signup-validation';
import { formatBizNo, isValidBizNo, onlyDigits } from '@/lib/format';
import { kstDate, kstDateTime } from '@/lib/kst';

export { sampleSettings, useSampleSettings } from './settings';
export type { SampleSettings } from './settings';

export const SAMPLE_DEMO_ACCOUNT = { usrId: 'ckp_demo', password: 'demo1234' } as const;

type AprYn = 'Y' | 'N' | 'D' | 'R' | 'S';

interface SampleAccount {
  user: AuthUser;
  aprYn: AprYn;
  /** 기본 계정은 SAMPLE_DEMO_ACCOUNT.password, 샘플 가입 계정은 가입 때 입력한 값 (메모리에만 있음) */
  password?: string;
}

/** 샘플 가입 계정의 권한 (sys_role_mng R0004 = 일반사용자, 기존 앱 가입과 같음) */
const SAMPLE_SIGNUP_ROLE_ID = 'R0004';

const USERS: SampleAccount[] = [
  {
    user: { usrId: 'ckp_demo', name: '김영업', companyName: '(주)씨케이피', phone: '010-1234-5678', email: 'demo@example.com', roleId: 'R0002' },
    aprYn: 'Y',
  },
  {
    user: { usrId: 'ckp_pending', name: '박대기', companyName: '(주)씨케이피', phone: null, email: null, roleId: 'R0002' },
    aprYn: 'N',
  },
  {
    user: { usrId: 'ckp_blocked', name: '최차단', companyName: '(주)씨케이피', phone: null, email: null, roleId: 'R0002' },
    aprYn: 'S',
  },
];

const APPROVAL_MESSAGES: Record<Exclude<AprYn, 'Y'>, string> = {
  N: '관리자 승인 대기중입니다.',
  D: '삭제 요청된 상태입니다.',
  R: '승인 보류된 상태입니다.',
  S: '접속차단 상태입니다.',
};

const EDI_DISABLED_MESSAGE = '현재 EDI 등록이 중단되어 있습니다. 관리자에게 문의해 주세요.';
/** 실패 흉내 시 한 사진이 연속으로 실패하는 횟수 (자동 재시도 2회까지 포함) */
const SAMPLE_FAIL_ATTEMPTS = 3;
const SESSION_KEY = 'ckp.sample.session';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UploadRecord extends EdiUpload {
  owner: string;
  imageUrl: string;
  used: boolean;
}

// ───────────── 도우미 ─────────────

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function fail(status: number, code: ApiClientErrorCode, message: string, extra?: { fields?: Record<string, string>; details?: Record<string, unknown> }): never {
  throw new ApiError({ status, code, message, ...extra });
}

function delay(signal?: AbortSignal, min = 150, max = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(ApiError.aborted());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(ApiError.aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, min + Math.random() * (max - min));
    signal?.addEventListener('abort', onAbort);
  });
}

function paginate<T>(items: T[], page?: number, pageSize?: number): Paged<T> {
  const size = Math.min(100, Math.max(1, Math.floor(pageSize ?? 30)));
  const p = Math.max(1, Math.floor(page ?? 1));
  const start = (p - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, page: p, pageSize: size, total: items.length, hasMore: start + slice.length < items.length };
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const includesCi = (value: string | null | undefined, q: string) => !!value && value.toLowerCase().includes(q);

function toMedicineSummary(m: MedicineDetail): MedicineSummary {
  return {
    code: m.code,
    name: m.name,
    company: m.company,
    packing: m.packing,
    ingredient: m.ingredient,
    priceText: m.priceText,
    price: m.price,
    fee: m.fee,
    inHouse: m.inHouse,
    contrastMedicine: m.contrastMedicine,
    imageUrl: m.imageUrl,
  };
}

function toNoticeSummary(n: NoticeDetail): NoticeSummary {
  return { idx: n.idx, title: n.title, author: n.author, regYmd: n.regYmd, important: n.important };
}

function toClientSummary(c: ClientDetail): ClientSummary {
  return {
    idx: c.idx,
    name: c.name,
    clientType: c.clientType,
    representative: c.representative,
    bizNo: c.bizNo,
    address: c.address,
    phone: c.phone,
    approval: c.approval,
    selectableForEdi: c.selectableForEdi,
  };
}

function toSubmissionSummary(s: EdiSubmissionDetail): EdiSubmissionSummary {
  const { photos: _photos, ...summary } = s;
  return summary;
}

async function loadSession(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' ? window.sessionStorage.getItem(SESSION_KEY) : null;
    }
    return await SecureStore.getItemAsync(SESSION_KEY);
  } catch {
    return null;
  }
}

async function saveSession(usrId: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      if (usrId) window.sessionStorage.setItem(SESSION_KEY, usrId);
      else window.sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    if (usrId) await SecureStore.setItemAsync(SESSION_KEY, usrId);
    else await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // 저장 실패 시 다음 실행에서 다시 로그인하면 된다
  }
}

/** 웹 blob URL 은 작성 화면이 초기화될 때 해제되므로, 샘플 내역용으로 별도 URL 을 만든다 */
async function stableImageUri(file: UploadFile): Promise<string> {
  if (Platform.OS !== 'web' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return file.uri;
  try {
    const blob = file.blob ?? (await (await fetch(file.uri)).blob());
    return URL.createObjectURL(blob);
  } catch {
    return file.uri;
  }
}

function simulateProgress(
  total: number,
  onProgress: UploadProgressHandler | undefined,
  signal: AbortSignal | undefined,
  stopAt: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(ApiError.aborted());
      return;
    }
    let fraction = 0;
    const onAbort = () => {
      clearInterval(timer);
      reject(ApiError.aborted());
    };
    const timer = setInterval(() => {
      fraction = Math.min(stopAt, fraction + 0.08 + Math.random() * 0.14);
      onProgress?.({ loaded: Math.round(total * fraction), total, fraction });
      if (fraction >= stopAt) {
        clearInterval(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }
    }, 90);
    signal?.addEventListener('abort', onAbort);
  });
}

// ───────────── 구현 ─────────────

export interface SampleApiOptions {
  onSessionExpired: () => void;
  platform: 'native' | 'web';
}

export function createSampleApi(options: SampleApiOptions): CkpApi {
  const owner = SAMPLE_DEMO_ACCOUNT.usrId;
  const requireApproval = DEFAULT_FEATURES.clientApprovalRequiredForEdi;

  let currentUser: AuthUser | null = null;
  /** 기본 계정 + 샘플에서 가입 신청한 계정(승인 대기, 앱을 다시 시작하면 사라짐) */
  const accounts: SampleAccount[] = USERS.map((u) => ({ ...u, user: clone(u.user) }));
  let ediIdxSeq = 90_000;
  const nextEdiIdx = () => (ediIdxSeq += 1);

  const clients: ClientDetail[] = buildSampleClients(owner, requireApproval);
  let nextClientIdx = 5000 + clients.length + 1;
  const submissions: EdiSubmissionDetail[] = buildSampleSubmissions(clients, nextEdiIdx);
  const uploadsByClientId = new Map<string, UploadRecord>();
  const uploadsById = new Map<string, UploadRecord>();
  const idempotency = new Map<string, { hash: string; submissionId: string }>();
  const seenPhotoIds = new Set<string>();
  const failPlan = new Map<string, number>();
  let newPhotoCounter = 0;

  function tokensFor(user: AuthUser): AuthTokensResponse {
    return {
      accessToken: `sample-access-${user.usrId}`,
      accessTokenExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      refreshToken: options.platform === 'native' ? `sample-refresh-${user.usrId}` : undefined,
      user: clone(user),
    };
  }

  function requireUser(): AuthUser {
    if (!currentUser) {
      options.onSessionExpired();
      fail(401, 'UNAUTHORIZED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    }
    return currentUser;
  }

  function assertEdiEnabled() {
    if (sampleSettings.get().simulateEdiDisabled) fail(403, 'EDI_DISABLED', EDI_DISABLED_MESSAGE);
  }

  function findClient(idx: number): ClientDetail | undefined {
    return clients.find((c) => c.idx === idx && c.ownerUsrId === owner);
  }

  function validateClient(body: ClientCreateRequest): Record<string, string> {
    const fields: Record<string, string> = {};
    const name = body.name?.trim() ?? '';
    if (!name) fields.name = '거래처명을 입력해 주세요.';
    else if (name.length > 100) fields.name = '거래처명은 100자 이하로 입력해 주세요.';
    if (body.clientType && body.clientType.trim().length > 50) fields.clientType = '거래처 구분은 50자 이하로 입력해 주세요.';
    if (body.bizNo?.trim()) {
      const digits = onlyDigits(body.bizNo);
      if (!/^[0-9-\s]+$/.test(body.bizNo.trim()) || digits.length !== 10) fields.bizNo = '사업자등록번호 10자리를 정확히 입력해 주세요.';
      else if (!isValidBizNo(digits)) fields.bizNo = '사업자등록번호가 유효하지 않습니다. 번호를 다시 확인해 주세요.';
    }
    if (body.representative && body.representative.trim().length > 100) fields.representative = '대표자명은 100자 이하로 입력해 주세요.';
    if (body.phone?.trim()) {
      if (!/^[0-9-]+$/.test(body.phone.trim())) fields.phone = '연락처는 숫자와 하이픈(-)만 입력할 수 있습니다.';
      else if (body.phone.trim().length > 20) fields.phone = '연락처는 20자 이하로 입력해 주세요.';
    }
    const address = [body.address?.trim(), body.addressDetail?.trim()].filter(Boolean).join(' ');
    if (address.length > 100) fields.address = '주소와 상세주소를 합쳐 100자 이하로 입력해 주세요.';
    if (body.zipCode?.trim() && !/^\d{5,6}$/.test(body.zipCode.trim())) fields.zipCode = '우편번호는 숫자 5자리로 입력해 주세요.';
    if (body.careCode && body.careCode.trim().length > 50) fields.careCode = '요양기관번호는 50자 이하로 입력해 주세요.';
    if (body.dispensary && body.dispensary.trim().length > 100) fields.dispensary = '문전약국은 100자 이하로 입력해 주세요.';
    if (body.memo && body.memo.trim().length > 200) fields.memo = '메모는 200자 이하로 입력해 주세요.';
    return fields;
  }

  /** 가입 중복 확인은 대소문자 구분 없이 (서버: lower(usr_id) = lower($1)) */
  const isUsrIdTaken = (usrId: string) => accounts.some((a) => usrIdKey(a.user.usrId) === usrIdKey(usrId));

  const isDuplicateName = (name: string, excludeIdx?: number) =>
    clients.some((c) => c.ownerUsrId === owner && c.idx !== excludeIdx && normalizeName(c.name) === normalizeName(name));
  const isDuplicateBizNo = (bizNo: string, excludeIdx?: number) =>
    clients.some((c) => c.ownerUsrId === owner && c.idx !== excludeIdx && !!c.bizNo && onlyDigits(c.bizNo) === onlyDigits(bizNo));

  const api: CkpApi = {
    mode: 'sample',
    baseUrl: null,
    resolveUrl: (url) => url ?? null,

    async getMeta(opts?: RequestOptions) {
      await delay(opts?.signal, 80, 200);
      return {
        apiVersion: API_VERSION,
        dataSource: 'development',
        storage: 'local',
        serverTime: kstDateTime(),
        features: { ...DEFAULT_FEATURES, selfRegistration: true },
        limits: clone(DEFAULT_EDI_LIMITS),
      };
    },

    // ── 인증 ──
    async login({ usrId, password }) {
      await delay(undefined, 300, 600);
      // 로그인 아이디는 대소문자까지 정확히 비교한다 (서버와 같음)
      const entry = accounts.find((u) => u.user.usrId === usrId.trim());
      if (!entry || password !== (entry.password ?? SAMPLE_DEMO_ACCOUNT.password)) {
        fail(401, 'INVALID_CREDENTIALS', '아이디 또는 비밀번호가 올바르지 않습니다.');
      }
      if (entry.aprYn !== 'Y') {
        fail(403, 'ACCOUNT_NOT_APPROVED', APPROVAL_MESSAGES[entry.aprYn], { details: { status: entry.aprYn } });
      }
      currentUser = entry.user;
      await saveSession(entry.user.usrId);
      return tokensFor(entry.user);
    },

    async refresh() {
      const user = currentUser ?? (await api.restoreSession());
      if (!user) fail(401, 'UNAUTHORIZED', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
      return tokensFor(user);
    },

    async restoreSession() {
      await delay(undefined, 150, 300);
      const usrId = await loadSession();
      const entry = accounts.find((u) => u.user.usrId === usrId && u.aprYn === 'Y');
      currentUser = entry?.user ?? null;
      if (!entry) await saveSession(null);
      return currentUser ? clone(currentUser) : null;
    },

    async logout() {
      currentUser = null;
      await saveSession(null);
    },

    async me(opts) {
      await delay(opts?.signal);
      return { user: clone(requireUser()) };
    },

    // ── 회원가입 ── (로그인 없이 호출, 토큰 없음)
    async checkUserId(usrId, opts) {
      await delay(opts?.signal, 120, 300);
      const id = normalizeUsrId(usrId);
      const error = validateUsrId(id);
      if (error) fail(400, 'VALIDATION_FAILED', error, { fields: { usrId: error } });
      const taken = isUsrIdTaken(id);
      return {
        usrId: id,
        available: !taken,
        message: taken ? SIGNUP_MESSAGES.usrIdDuplicate : SIGNUP_MESSAGES.usrIdAvailable,
      };
    },

    async register(body, opts) {
      await delay(opts?.signal, 400, 800);
      const fields = validateRegisterRequest(body);
      if (Object.keys(fields).length) fail(400, 'VALIDATION_FAILED', '입력 내용을 확인해 주세요.', { fields });
      const usrId = normalizeUsrId(body.usrId);
      if (isUsrIdTaken(usrId)) {
        fail(409, 'DUPLICATE_USER_ID', SIGNUP_MESSAGES.usrIdDuplicate, {
          fields: { usrId: '이미 사용 중인 아이디입니다. 다른 아이디를 입력해 주세요.' },
        });
      }
      accounts.push({
        user: {
          usrId,
          name: body.name.trim(),
          companyName: body.companyName?.trim() || null,
          phone: formatMobilePhone(body.phone.trim()),
          email: body.email?.trim().toLowerCase() || null,
          roleId: SAMPLE_SIGNUP_ROLE_ID,
        },
        aprYn: 'N',
        password: body.password,
      });
      return { usrId, status: 'pending', message: '가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.' };
    },

    // ── 의약품 ──
    async listMedicines(params, opts) {
      await delay(opts?.signal);
      requireUser();
      const q = params.q?.trim().toLowerCase() ?? '';
      const field = params.field ?? 'name';
      const filtered = SAMPLE_MEDICINES.filter((m) => {
        if (!q) return true;
        if (field === 'name') return includesCi(m.name, q);
        if (field === 'company') return includesCi(m.company, q);
        if (field === 'code') return includesCi(m.code, q);
        return includesCi(m.name, q) || includesCi(m.company, q) || includesCi(m.code, q) || includesCi(m.ingredient, q);
      }).sort((a, b) => compareText(medicineSortKey(a.name), medicineSortKey(b.name)) || compareText(a.code, b.code));
      return clone(paginate(filtered.map(toMedicineSummary), params.page, params.pageSize));
    },

    async getMedicine(code, opts) {
      await delay(opts?.signal);
      requireUser();
      const medicine = SAMPLE_MEDICINES.find((m) => m.code === code);
      if (!medicine) fail(404, 'NOT_FOUND', '의약품을 찾을 수 없습니다.');
      return { medicine: clone(medicine) };
    },

    // ── 공지사항 ──
    async listNotices(params, opts) {
      await delay(opts?.signal);
      requireUser();
      const q = params.q?.trim().toLowerCase() ?? '';
      const filtered = SAMPLE_NOTICES.filter((n) => !q || includesCi(n.title, q)).sort(
        (a, b) =>
          Number(b.important) - Number(a.important) ||
          compareText(b.regYmd ?? '', a.regYmd ?? '') ||
          b.idx - a.idx,
      );
      return clone(paginate(filtered.map(toNoticeSummary), params.page, params.pageSize));
    },

    async getNotice(idx, opts) {
      await delay(opts?.signal);
      requireUser();
      const notice = SAMPLE_NOTICES.find((n) => n.idx === idx);
      if (!notice) fail(404, 'NOT_FOUND', '공지사항을 찾을 수 없습니다.');
      return { notice: clone(notice) };
    },

    // ── 거래처 ──
    async listClients(params, opts) {
      await delay(opts?.signal);
      requireUser();
      const q = params.q?.trim().toLowerCase() ?? '';
      const qDigits = onlyDigits(q);
      const filtered = clients
        .filter((c) => c.ownerUsrId === owner)
        .filter(
          (c) =>
            !q ||
            includesCi(c.name, q) ||
            includesCi(c.representative, q) ||
            includesCi(c.address, q) ||
            includesCi(c.phone, q) ||
            (qDigits.length >= 3 && !!c.bizNo && onlyDigits(c.bizNo).includes(qDigits)),
        )
        .sort((a, b) => compareText(a.name, b.name));
      return clone(paginate(filtered.map(toClientSummary), params.page, params.pageSize));
    },

    async getClient(idx, opts) {
      await delay(opts?.signal);
      requireUser();
      const client = findClient(idx);
      if (!client) fail(404, 'NOT_FOUND', '거래처를 찾을 수 없습니다.');
      return { client: clone(client) };
    },

    async checkClientDuplicate(params, opts) {
      await delay(opts?.signal, 120, 300);
      requireUser();
      const name = params.name?.trim() ?? '';
      const nameResult = name
        ? (() => {
            const duplicate = isDuplicateName(name, params.excludeIdx);
            return { checked: true, duplicate, message: duplicate ? '이미 등록된 거래처명입니다.' : null };
          })()
        : { checked: false, duplicate: false, message: null };

      const rawBizNo = params.bizNo?.trim() ?? '';
      let bizResult = { checked: false, valid: false, duplicate: false, message: null as string | null };
      if (rawBizNo) {
        const digits = onlyDigits(rawBizNo);
        if (digits.length !== 10) {
          bizResult = { checked: true, valid: false, duplicate: false, message: '사업자등록번호 10자리를 정확히 입력해 주세요.' };
        } else if (!isValidBizNo(digits)) {
          bizResult = { checked: true, valid: false, duplicate: false, message: '사업자등록번호가 유효하지 않습니다. 번호를 다시 확인해 주세요.' };
        } else {
          const duplicate = isDuplicateBizNo(digits, params.excludeIdx);
          bizResult = { checked: true, valid: true, duplicate, message: duplicate ? '이미 등록된 사업자등록번호입니다.' : null };
        }
      }
      return { name: nameResult, bizNo: bizResult };
    },

    async createClient(body, opts) {
      await delay(opts?.signal, 300, 600);
      requireUser();
      const fields = validateClient(body);
      if (Object.keys(fields).length) fail(400, 'VALIDATION_FAILED', '입력 내용을 확인해 주세요.', { fields });
      const name = body.name.trim();
      if (isDuplicateName(name)) {
        fail(409, 'DUPLICATE_CLIENT_NAME', '이미 등록된 거래처명입니다.', { fields: { name: '이미 등록된 거래처명입니다. 다른 이름을 입력해 주세요.' } });
      }
      if (body.bizNo?.trim() && isDuplicateBizNo(body.bizNo)) {
        fail(409, 'DUPLICATE_BIZ_NO', '이미 등록된 사업자등록번호입니다.', { fields: { bizNo: '이미 등록된 사업자등록번호입니다.' } });
      }
      const trimOrNull = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
      const address = [body.address?.trim(), body.addressDetail?.trim()].filter(Boolean).join(' ');
      const client: ClientDetail = {
        idx: nextClientIdx++,
        name,
        clientType: trimOrNull(body.clientType),
        representative: trimOrNull(body.representative),
        bizNo: body.bizNo?.trim() ? formatBizNo(body.bizNo) : null,
        address: address || null,
        phone: trimOrNull(body.phone),
        approval: 'pending',
        selectableForEdi: !requireApproval,
        zipCode: trimOrNull(body.zipCode),
        careCode: trimOrNull(body.careCode),
        dispensary: trimOrNull(body.dispensary),
        memo: trimOrNull(body.memo),
        ownerUsrId: owner,
      };
      clients.push(client);
      return { client: clone(client) };
    },

    // ── EDI ──
    async getEdiStatus(opts) {
      await delay(opts?.signal, 100, 250);
      requireUser();
      const disabled = sampleSettings.get().simulateEdiDisabled;
      return { enabled: !disabled, message: disabled ? EDI_DISABLED_MESSAGE : null };
    },

    async getEdiMonthOptions(opts) {
      await delay(opts?.signal, 100, 250);
      requireUser();
      return buildMonthOptions();
    },

    async uploadEdiPhoto(file, clientPhotoId, onProgress, signal) {
      const user = requireUser();
      assertEdiEnabled();
      if (!UUID_RE.test(clientPhotoId)) fail(400, 'VALIDATION_FAILED', '사진 식별값이 올바르지 않습니다. 사진을 다시 선택해 주세요.');

      const existing = uploadsByClientId.get(clientPhotoId);
      if (existing && existing.owner === user.usrId) {
        await delay(signal, 100, 200);
        onProgress?.({ loaded: existing.bytes, total: existing.bytes, fraction: 1 });
        const { owner: _o, imageUrl: _i, used: _u, ...upload } = existing;
        return { upload: clone(upload), reused: true };
      }

      if (!DEFAULT_EDI_LIMITS.acceptedUploadTypes.includes(file.type)) {
        fail(415, 'UNSUPPORTED_FILE_TYPE', '지원하지 않는 파일 형식입니다. JPG, PNG, WEBP 사진만 올릴 수 있습니다.');
      }
      if (file.bytes && file.bytes > DEFAULT_EDI_LIMITS.photoMaxBytes) {
        fail(413, 'FILE_TOO_LARGE', '사진 용량이 너무 큽니다. 15MB 이하의 사진을 올려 주세요.');
      }

      const settings = sampleSettings.get();
      if (!seenPhotoIds.has(clientPhotoId)) {
        seenPhotoIds.add(clientPhotoId);
        newPhotoCounter += 1;
        if (settings.simulateUploadFailure && newPhotoCounter % 3 === 0) failPlan.set(clientPhotoId, SAMPLE_FAIL_ATTEMPTS);
      }
      const remainingFailures = settings.simulateUploadFailure ? (failPlan.get(clientPhotoId) ?? 0) : 0;
      const total = file.bytes && file.bytes > 0 ? file.bytes : 650_000;

      await simulateProgress(total, onProgress, signal, remainingFailures > 0 ? 0.45 : 1);
      if (remainingFailures > 0) {
        failPlan.set(clientPhotoId, remainingFailures - 1);
        throw ApiError.network();
      }

      const uri = await stableImageUri(file);
      const record: UploadRecord = {
        uploadId: Crypto.randomUUID(),
        clientPhotoId,
        bytes: total,
        width: file.width ?? 1920,
        height: file.height ?? 2560,
        thumbUrl: uri,
        imageUrl: uri,
        owner: user.usrId,
        used: false,
      };
      uploadsByClientId.set(clientPhotoId, record);
      uploadsById.set(record.uploadId, record);
      const { owner: _o, imageUrl: _i, used: _u, ...upload } = record;
      return { upload: clone(upload), reused: false };
    },

    async createEdiSubmission(body, idempotencyKey, opts) {
      await delay(opts?.signal, 400, 900);
      const user = requireUser();
      if (!UUID_RE.test(idempotencyKey)) fail(400, 'VALIDATION_FAILED', '요청 식별값이 올바르지 않습니다. 화면을 새로 열어 다시 등록해 주세요.');

      const orderedPhotos = [...(body.photos ?? [])].sort((a, b) => a.seq - b.seq);
      const memo = body.memo?.trim() ? body.memo.trim() : null;
      const hash = JSON.stringify({
        clientIdx: body.clientIdx,
        targetYm: body.targetYm,
        memo,
        photos: orderedPhotos.map((p) => p.uploadId),
      });
      const previous = idempotency.get(`${user.usrId}:${idempotencyKey}`);
      if (previous) {
        if (previous.hash !== hash) {
          fail(409, 'IDEMPOTENCY_CONFLICT', '이미 처리된 등록 요청과 내용이 다릅니다. 새 EDI 등록으로 다시 시도해 주세요.');
        }
        const existing = submissions.find((s) => s.id === previous.submissionId);
        if (existing) return { submission: clone(existing), replayed: true };
      }

      assertEdiEnabled();
      const limits = DEFAULT_EDI_LIMITS;
      if (orderedPhotos.length < limits.ediMinPhotos || orderedPhotos.length > limits.ediMaxPhotos) {
        fail(400, 'PHOTO_COUNT_OUT_OF_RANGE', `사진은 ${limits.ediMinPhotos}장 이상 ${limits.ediMaxPhotos}장 이하로 등록할 수 있습니다.`);
      }
      const seqOk = orderedPhotos.every((p, i) => p.seq === i + 1);
      const uniqueUploads = new Set(orderedPhotos.map((p) => p.uploadId)).size === orderedPhotos.length;
      if (!seqOk || !uniqueUploads) fail(400, 'VALIDATION_FAILED', '사진 순서 정보가 올바르지 않습니다. 다시 시도해 주세요.');
      if (memo && memo.length > limits.memoMaxLength) {
        fail(400, 'VALIDATION_FAILED', '입력 내용을 확인해 주세요.', { fields: { memo: `메모는 ${limits.memoMaxLength}자 이하로 입력해 주세요.` } });
      }
      const option = buildMonthOptions().options.find((o) => o.ym === body.targetYm);
      if (!option) fail(400, 'VALIDATION_FAILED', '대상 연월을 다시 선택해 주세요.', { fields: { targetYm: '대상 연월을 다시 선택해 주세요.' } });

      const client = findClient(body.clientIdx);
      if (!client) fail(404, 'NOT_FOUND', '거래처를 찾을 수 없습니다.');
      if (!client.selectableForEdi) fail(409, 'CLIENT_NOT_SELECTABLE', '관리자 승인 전인 거래처는 EDI 등록에 사용할 수 없습니다.');

      const records = orderedPhotos.map((p) => uploadsById.get(p.uploadId));
      const missing = orderedPhotos.filter((_, i) => !records[i] || records[i]?.owner !== user.usrId).map((p) => p.uploadId);
      if (missing.length) {
        fail(422, 'UPLOAD_NOT_FOUND', '업로드되지 않은 사진이 있습니다. 해당 사진을 다시 올려 주세요.', { details: { missing } });
      }
      if (records.some((r) => r?.used)) fail(409, 'UPLOAD_ALREADY_USED', '이미 다른 등록 건에 사용된 사진이 있습니다. 새 EDI 등록으로 다시 시도해 주세요.');

      const now = new Date();
      const regYmd = kstDate(now);
      const photos = records.map((r, i) => ({
        seq: i + 1,
        ediIdx: nextEdiIdx(),
        thumbUrl: r?.thumbUrl ?? null,
        imageUrl: r?.imageUrl ?? null,
        reviewStatus: 'needs_review' as const,
        printed: false,
        analyzed: false,
        pharmaCompanies: [],
      }));
      const submission: EdiSubmissionDetail = {
        id: Crypto.randomUUID(),
        kind: 'app',
        clientIdx: client.idx,
        clientName: client.name,
        targetYm: option.ym,
        monthLabel: monthLabelFor(regYmd, option.ym) ?? option.label,
        memo,
        photoCount: photos.length,
        createdAt: kstDateTime(now),
        regYmd,
        coverThumbUrl: photos[0]?.thumbUrl ?? null,
        statusCounts: countStatuses(photos),
        photos,
      };
      for (const r of records) if (r) r.used = true;
      submissions.unshift(submission);
      idempotency.set(`${user.usrId}:${idempotencyKey}`, { hash, submissionId: submission.id });
      return { submission: clone(submission), replayed: false };
    },

    async listEdiSubmissions(params, opts) {
      await delay(opts?.signal);
      requireUser();
      const filtered = submissions
        .filter((s) => s.regYmd.startsWith(params.ym))
        .sort((a, b) => compareText(b.createdAt ?? '', a.createdAt ?? ''));
      return clone(paginate(filtered.map(toSubmissionSummary), params.page, params.pageSize));
    },

    async getEdiSubmission(id, opts) {
      await delay(opts?.signal);
      requireUser();
      const submission = submissions.find((s) => s.id === id);
      if (!submission) fail(404, 'NOT_FOUND', '등록 내역을 찾을 수 없습니다.');
      return { submission: clone(submission) };
    },
  };

  return api;
}
