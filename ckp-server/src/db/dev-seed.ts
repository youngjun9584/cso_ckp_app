/**
 * 개발/테스트용 샘플 데이터 (PGlite 개발 DB 전용 — 운영 DB 에는 절대 사용하지 않는다).
 * 모든 회사·제품·거래처·인물 정보는 가상의 값이다.
 *
 * 계정 (비밀번호 모두 demo1234)
 *   ckp_demo  승인(Y), bcrypt 해시     — 거래처 15+개, 이전 방식 EDI 등록분 보유
 *   ckp_md5   승인(Y), MD5 해시        — 다른 담당자 데이터(소유 범위 확인용)
 *   ckp_wait  승인 대기(N)
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { withBizNoCheckDigit } from '../lib/bizno.js';
import { todayKst } from '../lib/kst.js';
import { hashPassword } from '../lib/password.js';
import type { Storage } from '../storage/index.js';
import type { Db, Queryable } from './pool.js';

export const DEMO_PASSWORD = 'demo1234';

export const DEMO_ACCOUNTS = [
  { usrId: 'ckp_demo', password: DEMO_PASSWORD, description: '승인된 사용자 (bcrypt)' },
  { usrId: 'ckp_md5', password: DEMO_PASSWORD, description: '승인된 사용자 (MD5 — 관리자 비밀번호 초기화 방식)' },
  { usrId: 'ckp_wait', password: DEMO_PASSWORD, description: '승인 대기 사용자 (로그인 거부 확인용)' },
] as const;

export interface SeedOptions {
  /** 기준 시각 (EDI 등록일 등 상대 날짜 계산) */
  now: Date;
  /** 로컬 저장소면 이전 방식 EDI 샘플 이미지를 기록한다 */
  storage?: Storage | null;
  /** 이미 데이터가 있어도 다시 넣을지 (기본 false: 사용자 테이블이 비어 있을 때만) */
  force?: boolean;
}

export interface SeedSummary {
  seeded: boolean;
  users: number;
  medicines: number;
  notices: number;
  clients: number;
  ediRows: number;
}

// ───────────────────────── 유틸 ─────────────────────────

/** 결정적 난수 (mulberry32) — 실행할 때마다 같은 샘플 데이터 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function insertRows(q: Queryable, table: string, columns: string[], rows: unknown[][], chunk = 40): Promise<void> {
  for (let start = 0; start < rows.length; start += chunk) {
    const part = rows.slice(start, start + chunk);
    const params: unknown[] = [];
    const tuples = part.map((row) => {
      const ph = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(', ')})`;
    });
    await q.query(`INSERT INTO public.${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')}`, params);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const md5 = (s: string) => createHash('md5').update(Buffer.from(s, 'utf8')).digest('hex');

function formatPrice(n: number): string {
  return n >= 1000 ? n.toLocaleString('en-US') : String(n);
}

// ───────────────────────── 의약품 ─────────────────────────

const COMPANIES = [
  '한결제약', '대한바이오팜', '서울신약', '동진약품', '미래제약', '새봄헬스케어',
  '청운제약', '누리바이오', '한마음약품', '백두제약', '가온팜', '다솜제약',
];

interface Ingredient {
  stem: string;
  salt: string;
  base: string;
  strengths: number[];
  ratio: number; // 염 환산 계수
  form: '정' | '캡슐' | '서방정' | '필름코팅정';
  cls: string;
  welfare: string;
}

const INGREDIENTS: Ingredient[] = [
  { stem: '아토르', salt: '아토르바스타틴칼슘삼수화물', base: '아토르바스타틴', strengths: [10, 20, 40], ratio: 1.085, form: '정', cls: '동맥경화용제', welfare: '218' },
  { stem: '로수', salt: '로수바스타틴칼슘', base: '로수바스타틴', strengths: [5, 10, 20], ratio: 1.04, form: '정', cls: '동맥경화용제', welfare: '218' },
  { stem: '암로', salt: '암로디핀베실산염', base: '암로디핀', strengths: [5, 10], ratio: 1.39, form: '정', cls: '혈압강하제', welfare: '214' },
  { stem: '텔미', salt: '텔미사르탄', base: '텔미사르탄', strengths: [40, 80], ratio: 1, form: '정', cls: '혈압강하제', welfare: '214' },
  { stem: '메트', salt: '메트포르민염산염', base: '메트포르민염산염', strengths: [500, 850, 1000], ratio: 1, form: '서방정', cls: '당뇨병용제', welfare: '396' },
  { stem: '시타', salt: '시타글립틴인산염수화물', base: '시타글립틴', strengths: [50, 100], ratio: 1.285, form: '필름코팅정', cls: '당뇨병용제', welfare: '396' },
  { stem: '에소', salt: '에스오메프라졸마그네슘삼수화물', base: '에스오메프라졸', strengths: [20, 40], ratio: 1.112, form: '정', cls: '소화성궤양용제', welfare: '232' },
  { stem: '레바', salt: '레바미피드', base: '레바미피드', strengths: [100], ratio: 1, form: '정', cls: '소화성궤양용제', welfare: '232' },
  { stem: '클로피', salt: '클로피도그렐황산수소염', base: '클로피도그렐', strengths: [75], ratio: 1.308, form: '필름코팅정', cls: '혈액응고저지제', welfare: '339' },
  { stem: '세레', salt: '세레콕시브', base: '세레콕시브', strengths: [100, 200], ratio: 1, form: '캡슐', cls: '해열·진통·소염제', welfare: '114' },
  { stem: '레보세', salt: '레보세티리진염산염', base: '레보세티리진염산염', strengths: [5], ratio: 1, form: '정', cls: '항히스타민제', welfare: '141' },
  { stem: '몬테', salt: '몬테루카스트나트륨', base: '몬테루카스트', strengths: [4, 5, 10], ratio: 1.04, form: '정', cls: '기타의 알레르기용약', welfare: '149' },
];

const SUFFIXES = ['젠', '린', '탄', '엘', '큐', '온', '스', '엔', '벨', '틴', '로', '뮨'];
const PACKINGS = ['30정/병', '100정(10정×10)/PTP', '28정(14정×2)/PTP', '300정/병', '500정/병', '30캡슐/병'];
const ADDITIVES = '유당수화물, 미결정셀룰로오스, 크로스카르멜로오스나트륨, 스테아르산마그네슘, 히프로멜로오스';
const PREFIXES = ['[X] ', '★', '◎', '[NP] '];

function buildMedicines(): unknown[][] {
  const rand = rng(20260925);
  const rows: unknown[][] = [];
  let n = 0;
  COMPANIES.forEach((company, ci) => {
    for (let pi = 0; pi < 11; pi++) {
      const ing = INGREDIENTS[(ci + pi) % INGREDIENTS.length] as Ingredient;
      const strength = ing.strengths[(ci * 3 + pi) % ing.strengths.length] as number;
      const suffix = SUFFIXES[(ci + pi * 5) % SUFFIXES.length] as string;
      const formWord = ing.form === '캡슐' ? '캡슐' : ing.form;
      let name = `${ing.stem}${suffix}${formWord} ${strength}밀리그램`;
      if (n % 29 === 7) name = `${PREFIXES[Math.floor(n / 29) % PREFIXES.length] ?? '★'}${name}`;
      const code = `${String(641 + ci * 3).padStart(3, '0')}${String(1000 + pi * 137 + ci * 11).padStart(5, '0')}${(ci + pi) % 10}`;
      const priceNum = Math.round((80 + rand() * 1400) * (strength >= 500 ? 0.4 : 1));
      const pay = n % 23 === 5 ? '미정' : n % 41 === 9 ? '0' : formatPrice(priceNum);
      const saltAmount = Math.round(strength * ing.ratio * 100) / 100;
      const ingredient =
        n % 17 === 3 ? null : ing.ratio === 1 ? `${ing.salt} ${strength}mg` : `${ing.salt} ${saltAmount}mg (${ing.base}으로서 ${strength}mg)`;
      const packing = n % 13 === 4 ? null : (PACKINGS[(ci + pi) % PACKINGS.length] as string);
      const type1 = n % 9 === 0 ? '일반' : '전문';
      const type2 = n % 11 === 0 ? '비급여' : '급여';
      const tax = n % 7 === 2 ? null : String(30 + ((ci * 7 + pi * 3) % 25));
      const tax2 = n % 3 === 0 ? String(25 + (pi % 10)) : null;
      const tax3 = n % 5 === 0 ? `${20 + (ci % 5)}.5` : null;
      const tax4 = null;
      const regYmd = `2026-${String(1 + ((ci + pi) % 8)).padStart(2, '0')}-${String(1 + ((ci * 5 + pi) % 27)).padStart(2, '0')}`;
      const imageUrl = n % 50 === 10 ? `http://example.com/medicine/${code}.png` : null; // https 가 아니므로 앱에는 표시되지 않아야 함
      rows.push([
        code,
        name,
        type1,
        type2,
        `${ing.welfare} ${ing.cls}`,
        company,
        pay,
        ingredient,
        n % 6 === 0 ? null : ADDITIVES,
        packing,
        n % 8 === 1 ? '생물학적동등성 시험 완료' : null,
        n % 10 === 0 ? '관리자 메모: 단가 협의 중 (앱 비노출)' : null,
        regYmd,
        imageUrl,
        tax,
        tax2,
        tax3,
        tax4,
        '0',
        n % 12 === 2 ? `${ing.base} 대조약` : null,
        ing.welfare,
        n % 15 === 14 ? 'N' : 'Y',
        'NONE_TARGET',
        n % 4 === 0 ? 'O' : 'X',
      ]);
      n++;
    }
  });
  return rows;
}

const MEDICINE_COLUMNS = [
  'medicine_code', 'name', 'type1', 'type2', 'medicine_class', 'company', 'pay', 'ingredient', 'medicine_add',
  'medicine_packing', 'ee', 'ee2', 'reg_ymd', 'image_url', 'tax', 'tax_2', 'tax_3', 'tax_4', 'decrease_tax',
  'contrast_medicine', 'welfare_code', 'medicine_is', 'is_live', 'is_maker',
];

// ───────────────────────── 공지 ─────────────────────────


const NOTICE_TITLES = [
  '2026년 10월 EDI 제출 마감 일정 안내',
  '추석 연휴 기간 정산 일정 변경 안내',
  'CKP 업무 앱 출시 및 이용 방법 안내',
  '거래처 등록 시 사업자등록번호 확인 절차 안내',
  '9월 수수료 정산 완료 안내',
  '신규 품목 추가 안내 (한결제약 외 3개사)',
  '개인정보 처리방침 개정 안내',
  'EDI 사진 촬영 시 유의사항',
  '시스템 정기 점검 안내 (토요일 02:00~04:00)',
  '약가 인하 품목 반영 안내',
  '8월 실적 집계 일정 안내',
  '거래처 승인 절차 변경 안내',
  '영업 담당자 교육 일정 안내',
  '의약품 공급 일시 중단 품목 안내',
  '처방 조회 기간 연장 안내',
  '하반기 CSO 협력 정책 안내',
  '모바일 앱 로그인 오류 해결 안내',
  '분기 정산 서류 제출 안내',
  '품목별 수수료율 변경 안내',
  '거래처 이관 신청 방법 안내',
  '10월 신규 제휴 제약사 안내',
  '정산 지연 관련 사과 말씀',
  'EDI 사진 업로드 용량 기준 변경 안내',
  '연말 정산 일정 사전 안내',
  '고객센터 운영 시간 변경 안내',
  '보안 점검 결과 및 비밀번호 변경 권고',
];

function noticeContents(i: number, pngBase64: string): string {
  switch (i) {
    case 0:
      return '<p><strong>10월 EDI 제출 마감일은 10월 5일(월) 18:00입니다.</strong></p><p class="ql-align-center">마감 이후 제출분은 다음 달로 이월됩니다.</p><ul><li>처방전 사진은 글자가 잘 보이도록 촬영해 주세요.</li><li>한 번에 최대 30장까지 등록할 수 있습니다.</li></ul>';
    case 1:
      return '<p>추석 연휴(10월 3일~10월 9일) 기간에는 정산 업무를 쉽니다.</p><p>연휴 이후 <em>10월 12일</em>부터 순차 처리됩니다.</p>';
    case 2:
      return `<h2>CKP 업무 앱을 소개합니다</h2><p>의약품 조회, 공지사항, EDI 등록, 거래처 관리를 한 곳에서 할 수 있습니다.</p><p><img src="data:image/png;base64,${pngBase64}" alt="앱 화면 예시"></p><p>문의: <a href="mailto:support@example.com">support@example.com</a> / <a href="tel:1588-0000">1588-0000</a></p>`;
    case 3:
      return '<p>거래처 등록 시 사업자등록번호 10자리를 정확히 입력해 주세요.</p><script>alert("xss")</script><p><img src="x" onerror="alert(1)">잘못된 번호는 등록되지 않습니다.</p>';
    case 7:
      return '<p>EDI 사진 촬영 방법 영상을 참고해 주세요.</p><iframe class="ql-video" frameborder="0" allowfullscreen="true" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe><p><a href="javascript:alert(1)">이 링크는 동작하지 않아야 합니다</a></p>';
    case 8:
      return '<p style="color:red" onclick="alert(1)">점검 시간에는 앱 이용이 제한됩니다.</p><table><tbody><tr><td>일시</td><td>토요일 02:00~04:00</td></tr></tbody></table>';
    default:
      return `<p>${NOTICE_TITLES[i] ?? '공지'} 내용입니다.</p><p>자세한 사항은 담당자에게 문의해 주세요.</p>`;
  }
}

function buildNotices(now: Date, pngBase64: string): unknown[][] {
  return NOTICE_TITLES.map((title, i) => {
    const regYmd = i === 24 ? null : todayKst(new Date(now.getTime() - (i * 4 + 1) * DAY_MS));
    const important = i === 0 || i === 6 || i === 12 ? 'true' : i === 25 ? null : 'false';
    const author = i % 3 === 0 ? '관리자' : i % 3 === 1 ? 'CKP 운영팀' : '정산팀';
    return [author, title, noticeContents(i, pngBase64), regYmd, important];
  });
}

// ───────────────────────── 거래처 ─────────────────────────

interface ClientSeed {
  owner: string;
  name: string;
  type: string | null;
  doctor: string | null;
  bizNo: string | null;
  address: string | null;
  zip: string | null;
  care: string | null;
  dispensary: string | null;
  phone: string | null;
  memo: string | null;
  approval: boolean | null;
}

function buildClients(): ClientSeed[] {
  const biz = (first9: string, hyphen = true) => {
    const d = withBizNoCheckDigit(first9);
    return hyphen ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d;
  };
  const demo: Omit<ClientSeed, 'owner'>[] = [
    { name: '서울튼튼내과의원', type: '의원', doctor: '김건강', bizNo: biz('314812345'), address: '대전광역시 서구 둔산로 100, 3층', zip: '35233', care: '34100123', dispensary: '둔산온누리약국', phone: '042-123-4567', memo: '화·목 오전 방문', approval: true },
    { name: '한빛소아청소년과의원', type: '의원', doctor: '이아름', bizNo: biz('305271111', false), address: '대전광역시 유성구 대학로 45', zip: '34134', care: '34200456', dispensary: '한빛약국', phone: '042-222-3333', memo: null, approval: true },
    { name: '대전연세정형외과', type: '의원', doctor: '박튼튼', bizNo: biz('306459876'), address: '대전광역시 중구 중앙로 77, 5층', zip: '34910', care: '34300789', dispensary: null, phone: '042-333-4444', memo: '원장님 점심시간 12~14시', approval: true },
    { name: '미소가정의학과의원', type: '의원', doctor: '최미소', bizNo: null, address: '세종특별자치시 한누리대로 250', zip: '30121', care: null, dispensary: '미소약국', phone: '044-555-6666', memo: null, approval: true },
    { name: '새봄산부인과의원', type: '의원', doctor: '정새봄', bizNo: biz('211876543'), address: '서울특별시 강남구 테헤란로 120, 7층', zip: '06132', care: '11100321', dispensary: null, phone: '02-555-1234', memo: null, approval: true },
    { name: '둔산365의원', type: '의원', doctor: '한밤중', bizNo: '123-45-67891', address: '대전광역시 서구 대덕대로 200', zip: '35240', care: '34100999', dispensary: '365약국', phone: '042-365-3650', memo: '사업자번호 확인 필요(검증번호 불일치)', approval: true },
    { name: '대덕종합병원', type: '종합병원', doctor: '오병원', bizNo: biz('314820001'), address: '대전광역시 대덕구 한밭대로 1000', zip: '34350', care: '34010001', dispensary: null, phone: '042-600-1000', memo: '약제부 경유', approval: true },
    { name: '유성온천내과', type: '의원', doctor: '서온천', bizNo: biz('305112233'), address: '대전광역시 유성구 온천로 50', zip: '34185', care: '34200111', dispensary: '온천약국', phone: '042-821-0000', memo: null, approval: null },
    { name: '중앙메디컬병원', type: '병원', doctor: '윤중앙', bizNo: biz('306998877'), address: '대전광역시 중구 대종로 300', zip: '34917', care: '34020002', dispensary: null, phone: '042-252-7000', memo: null, approval: null },
    { name: '밝은눈안과의원', type: '의원', doctor: '장밝음', bizNo: '3148223344', address: '대전광역시 서구 계룡로 400', zip: '35300', care: null, dispensary: null, phone: '0425554444', memo: '전화번호 하이픈 없이 등록된 예', approval: null },
    { name: '참편한통증의학과', type: '의원', doctor: '강편안', bizNo: biz('305667788'), address: '대전광역시 유성구 봉명로 12', zip: '34170', care: '34200222', dispensary: '봉명약국', phone: '042-826-1111', memo: '신규 등록(승인 대기)', approval: false },
    { name: '봄날피부과의원', type: '의원', doctor: '신봄날', bizNo: biz('211334455'), address: '서울특별시 서초구 강남대로 400', zip: '06614', care: null, dispensary: null, phone: '02-3478-0000', memo: null, approval: false },
    { name: '행복한약국', type: '약국', doctor: '임행복', bizNo: biz('314556677'), address: '대전광역시 동구 대전로 800', zip: '34587', care: '34700333', dispensary: null, phone: '042-632-0000', memo: null, approval: false },
    { name: '우리들이비인후과의원', type: '의원', doctor: '노우리', bizNo: null, address: null, zip: null, care: null, dispensary: null, phone: null, memo: '정보 미입력 거래처', approval: false },
    { name: '늘푸른내과의원', type: null, doctor: null, bizNo: '사업자번호 미확인', address: '충청남도 천안시 동남구 만남로 10', zip: '31127', care: null, dispensary: null, phone: '041-555-0000', memo: '구분 미지정', approval: true },
    { name: 'Good Morning 의원', type: '의원', doctor: '문아침', bizNo: biz('305009988'), address: '대전광역시 서구 문정로 5', zip: '35262', care: null, dispensary: null, phone: '042-111-2222', memo: '영문 이름 정렬 확인용', approval: true },
  ];
  const md5User: Omit<ClientSeed, 'owner'>[] = [
    { name: '서울튼튼내과의원', type: '의원', doctor: '김건강', bizNo: biz('314812345'), address: '대전광역시 서구 둔산로 100, 3층', zip: '35233', care: '34100123', dispensary: null, phone: '042-123-4567', memo: '다른 담당자의 같은 이름 거래처', approval: true },
    { name: '청주바른내과', type: '의원', doctor: '배바른', bizNo: biz('301445566'), address: '충청북도 청주시 상당구 상당로 70', zip: '28542', care: null, dispensary: null, phone: '043-222-0000', memo: null, approval: true },
    { name: '공주우리병원', type: '병원', doctor: '홍우리', bizNo: null, address: '충청남도 공주시 봉황로 1', zip: '32545', care: null, dispensary: null, phone: '041-850-0000', memo: null, approval: false },
  ];
  const waitUser: Omit<ClientSeed, 'owner'>[] = [
    { name: '대기중의원', type: '의원', doctor: null, bizNo: null, address: null, zip: null, care: null, dispensary: null, phone: null, memo: null, approval: false },
  ];
  return [
    ...demo.map((c) => ({ ...c, owner: 'ckp_demo' })),
    ...md5User.map((c) => ({ ...c, owner: 'ckp_md5' })),
    ...waitUser.map((c) => ({ ...c, owner: 'ckp_wait' })),
  ];
}

// ───────────────────────── 이전 방식 EDI ─────────────────────────

async function sampleJpeg(label: string, width: number, height: number, hue: number): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="hsl(${hue},45%,92%)"/>` +
      `<rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none" stroke="hsl(${hue},40%,45%)" stroke-width="6"/>` +
      `<text x="50%" y="45%" font-family="sans-serif" font-size="${Math.round(width / 12)}" text-anchor="middle" fill="hsl(${hue},40%,30%)">EDI SAMPLE</text>` +
      `<text x="50%" y="58%" font-family="sans-serif" font-size="${Math.round(width / 16)}" text-anchor="middle" fill="hsl(${hue},40%,30%)">${label}</text>` +
      `</svg>`,
  );
  return sharp(svg).jpeg({ quality: 80 }).toBuffer();
}

interface LegacyEdiSeed {
  owner: string;
  hospital: string;
  month: string | null;
  createAt: string | null;
  regYmd: string;
  dealType: string;
  pharmacist: string;
  print: boolean;
  isOcr: boolean;
  isCopy: boolean | null;
  imageKey: string | null; // 저장소 키 (aws_url = 'local:' + key)
  dataUrl: boolean; // edi_image 에 data URL 저장
  label: string;
}

function buildLegacyEdi(now: Date): LegacyEdiSeed[] {
  const at = (daysAgo: number, hh: number, mm: number) => {
    const base = new Date(now.getTime() - daysAgo * DAY_MS);
    const ymd = todayKst(base);
    return { createAt: `${ymd} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`, regYmd: ymd };
  };
  const a = at(0, 9, 12);
  const b = at(2, 14, 5);
  const c = at(35, 11, 40);
  const d = at(1, 16, 30);
  const common = { dealType: '기존', print: false, isOcr: false, isCopy: false as boolean | null, dataUrl: false };
  return [
    // 그룹 A: 오늘 3장 (검토필요/검토완료/검토필요)
    { ...common, owner: 'ckp_demo', hospital: '서울튼튼내과의원', month: '당월', ...a, pharmacist: '', imageKey: 'seed/edi/legacy-a-1.jpg', label: 'A-1' },
    { ...common, owner: 'ckp_demo', hospital: '서울튼튼내과의원', month: '당월', ...a, pharmacist: '한결제약', print: true, isOcr: true, imageKey: 'seed/edi/legacy-a-2.jpg', label: 'A-2' },
    { ...common, owner: 'ckp_demo', hospital: '서울튼튼내과의원', month: '당월', ...a, pharmacist: '한결제약,서울신약', isOcr: true, imageKey: 'seed/edi/legacy-a-3.jpg', label: 'A-3' },
    // 그룹 B: 2일 전 2장 (삭제요청 / 숫자만 → 검토필요)
    { ...common, owner: 'ckp_demo', hospital: '한빛소아청소년과의원', month: '전월', ...b, dealType: '삭제요청', pharmacist: '', imageKey: 'seed/edi/legacy-b-1.jpg', label: 'B-1' },
    { ...common, owner: 'ckp_demo', hospital: '한빛소아청소년과의원', month: '전월', ...b, pharmacist: '641012340', imageKey: 'seed/edi/legacy-b-2.jpg', label: 'B-2' },
    // 관리자 복사본 (is_copy = true → 앱 내역에서 제외 대상)
    { ...common, owner: 'ckp_demo', hospital: '한빛소아청소년과의원', month: '전월', ...b, pharmacist: '', isCopy: true, imageKey: 'seed/edi/legacy-b-1.jpg', label: 'B-1(복사본)' },
    // 그룹 C: 약 35일 전, edi_image(data URL) 에만 이미지가 있는 구 방식
    { ...common, owner: 'ckp_demo', hospital: '대전연세정형외과', month: '당월', ...c, pharmacist: '대한바이오팜', imageKey: null, dataUrl: true, label: 'C-1' },
    // 그룹 D: 관리자 등록(월·등록시각 없음)
    { ...common, owner: 'ckp_demo', hospital: '미소가정의학과의원', month: null, createAt: null, regYmd: d.regYmd, dealType: '매출', pharmacist: '', isCopy: null, imageKey: 'seed/edi/legacy-d-1.jpg', label: 'D-1' },
    // 다른 사용자
    { ...common, owner: 'ckp_md5', hospital: '청주바른내과', month: '당월', ...a, pharmacist: '', imageKey: 'seed/edi/legacy-x-1.jpg', label: 'X-1' },
  ];
}

// ───────────────────────── 실행 ─────────────────────────

export async function seedDevData(db: Db, opts: SeedOptions): Promise<SeedSummary> {
  const existing = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.sys_app_usr_mng');
  if (!opts.force && (existing.rows[0]?.n ?? 0) > 0) {
    return { seeded: false, users: 0, medicines: 0, notices: 0, clients: 0, ediRows: 0 };
  }

  const bcryptHash = await hashPassword(DEMO_PASSWORD, 10);
  const waitHash = await hashPassword(DEMO_PASSWORD, 10);
  const legacy = buildLegacyEdi(opts.now);

  // 이미지 먼저 준비 (트랜잭션 밖에서 CPU 작업)
  const images = new Map<string, Buffer>();
  const dataUrls = new Map<string, Buffer>();
  for (const [i, row] of legacy.entries()) {
    if (row.imageKey && !images.has(row.imageKey)) images.set(row.imageKey, await sampleJpeg(row.label, 900, 1200, (i * 47) % 360));
    if (row.dataUrl) {
      const jpg = await sampleJpeg(row.label, 600, 800, 200);
      dataUrls.set(row.label, Buffer.from(`data:image/jpeg;base64,${jpg.toString('base64')}`, 'ascii'));
    }
  }
  if (opts.storage && opts.storage.driver === 'local') {
    for (const [key, buf] of images) await opts.storage.put(key, buf, 'image/jpeg');
  }

  const medicines = buildMedicines();
  const png = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#0873B9' } }).png().toBuffer();
  const notices = buildNotices(opts.now, png.toString('base64'));
  const clients = buildClients();
  const joinYmd = todayKst(new Date(opts.now.getTime() - 200 * DAY_MS));

  await db.tx(async (q) => {
    await insertRows(
      q,
      'sys_app_usr_mng',
      ['usr_id', 'usr_pwd', 'usr_nam', 'tel', 'phone', 'email', 'address', 'cpy_nam', 'cpy_number', 'cpy_address', 'bankbook_name', 'bankbook_number',
        'bankbook_security_number', 'apr_yn', 'join_ymd', 'role_id', 'gbn', 'cpy_image', 'bankbook_image', 'classification', 'coalition_company'],
      [
        ['ckp_demo', bcryptHash, '김영업', '042-000-0001', '010-1234-5678', 'demo@example.com', '대전광역시 서구 둔산로 1', 'CKP파트너스', '314-81-00001',
          '영업1팀', '김영업', '000-0000-0000-01', '000000-0000000', 'Y', joinYmd, 'R0004', '일반', Buffer.from('sample-cpy-image'), Buffer.from('sample-bankbook'), '영업', 'false'],
        ['ckp_md5', md5(DEMO_PASSWORD), '이현장', null, '010-2222-3333', 'field@example.com', null, 'CKP파트너스', null,
          null, null, null, null, 'Y', joinYmd, 'R0004', '일반', null, null, null, 'false'],
        ['ckp_wait', waitHash, '박대기', null, '010-4444-5555', null, null, '대기상사', null,
          null, null, null, null, 'N', joinYmd, 'R0004', '일반', null, null, null, 'false'],
      ],
    );

    await insertRows(q, 'medicine', MEDICINE_COLUMNS, medicines);

    await insertRows(q, 'frees', ['idx', 'name', 'list'], [
      ['tax', '기본 수수료', true],
      ['tax_2', '수수료2', false],
      ['tax_3', '수수료3', false],
      ['tax_4', '수수료4', false],
    ]);

    await insertRows(q, 'notice', ['author', 'title', 'contents', 'reg_ymd', 'important'], notices);

    await insertRows(
      q,
      'mannager_by_hospital',
      ['user_id', 'hospital', 'hospital_type', 'doctor_name', 'cpy_number', 'address', 'zip_code', 'care_code', 'dispensary', 'phone', 'ee', 'approval'],
      clients.map((c) => [c.owner, c.name, c.type, c.doctor, c.bizNo, c.address, c.zip, c.care, c.dispensary, c.phone, c.memo, c.approval]),
    );

    await insertRows(q, 'is_edi', ['edi', 'coalition_company'], [[false, null]]);

    // idx 오름차순 = 사진 순서가 되도록 한 행씩 넣는다
    for (const row of legacy) {
      await q.query(
        `INSERT INTO public.edi (deal_type, hospital_name, pharmacist, user_id, edi_image, reg_ymd, print, month, is_ocr, ocr, aws_url, move_month, create_at, is_copy)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, NULL, $10, false, $11, $12)`,
        [
          row.dealType,
          row.hospital,
          row.pharmacist,
          row.owner,
          row.dataUrl ? (dataUrls.get(row.label) ?? null) : null,
          row.regYmd,
          row.print,
          row.month,
          row.isOcr,
          row.imageKey ? `local:${row.imageKey}` : null,
          row.createAt,
          row.isCopy,
        ],
      );
    }
  });

  return {
    seeded: true,
    users: 3,
    medicines: medicines.length,
    notices: notices.length,
    clients: clients.length,
    ediRows: legacy.length,
  };
}

/** 개발 서버 시작 로그용 안내 문구 */
export function demoAccountsNotice(): string {
  const lines = DEMO_ACCOUNTS.map((a) => `  - ${a.usrId} / ${a.password}  (${a.description})`);
  return ['개발용 샘플 계정 (개발 DB 전용):', ...lines].join('\n');
}
