/**
 * 샘플 의약품 데이터 (가상의 제품명·제약사 — 실제 제품이 아님). 성분명만 일반명을 사용한다.
 * 결정적으로 생성되므로 새로고침해도 같은 목록이 나온다.
 */
import type { MedicineDetail } from '../contract';

const COMPANIES = [
  'CKP제약',
  '한결제약',
  '다온약품',
  '새빛바이오',
  '미래헬스케어',
  '온유제약',
  '청명약품',
  '가온팜',
  '누리제약',
  '한솔바이오팜',
] as const;

interface MedicineBase {
  stem: string;
  form: '정' | '캡슐' | '서방정' | '필름코팅정' | '시럽';
  ingredient: string;
  strengths: string[];
  klass: string;
  welfare: string;
  otc?: boolean;
  nonCovered?: boolean;
  basePrice: number;
}

const BASES: MedicineBase[] = [
  { stem: '리피온', form: '정', ingredient: '아토르바스타틴칼슘삼수화물', strengths: ['10mg', '20mg', '40mg'], klass: '동맥경화용제', welfare: '218', basePrice: 420 },
  { stem: '로수엔', form: '정', ingredient: '로수바스타틴칼슘', strengths: ['5mg', '10mg', '20mg'], klass: '동맥경화용제', welfare: '218', basePrice: 380 },
  { stem: '암로젠', form: '정', ingredient: '암로디핀베실산염', strengths: ['5mg', '10mg'], klass: '혈압강하제', welfare: '214', basePrice: 240 },
  { stem: '텔미원', form: '정', ingredient: '텔미사르탄', strengths: ['40mg', '80mg'], klass: '혈압강하제', welfare: '214', basePrice: 360 },
  { stem: '올메탄', form: '필름코팅정', ingredient: '올메사르탄메독소밀', strengths: ['10mg', '20mg', '40mg'], klass: '혈압강하제', welfare: '214', basePrice: 390 },
  { stem: '발사온', form: '필름코팅정', ingredient: '발사르탄', strengths: ['80mg', '160mg'], klass: '혈압강하제', welfare: '214', basePrice: 410 },
  { stem: '메포민', form: '서방정', ingredient: '메트포르민염산염', strengths: ['500mg', '750mg', '1000mg'], klass: '당뇨병용제', welfare: '396', basePrice: 110 },
  { stem: '글리온', form: '정', ingredient: '글리메피리드', strengths: ['1mg', '2mg', '4mg'], klass: '당뇨병용제', welfare: '396', basePrice: 90 },
  { stem: '시타원', form: '필름코팅정', ingredient: '시타글립틴인산염수화물', strengths: ['50mg', '100mg'], klass: '당뇨병용제', welfare: '396', basePrice: 520 },
  { stem: '에소졸', form: '정', ingredient: '에소메프라졸마그네슘삼수화물', strengths: ['20mg', '40mg'], klass: '소화성궤양용제', welfare: '232', basePrice: 610 },
  { stem: '라베온', form: '정', ingredient: '라베프라졸나트륨', strengths: ['10mg', '20mg'], klass: '소화성궤양용제', welfare: '232', basePrice: 540 },
  { stem: '레바온', form: '정', ingredient: '레바미피드', strengths: ['100mg'], klass: '소화성궤양용제', welfare: '232', basePrice: 105 },
  { stem: '모사원', form: '정', ingredient: '모사프리드시트르산염수화물', strengths: ['5mg'], klass: '기타의 소화기관용약', welfare: '239', basePrice: 95 },
  { stem: '세클러', form: '캡슐', ingredient: '세파클러수화물', strengths: ['250mg'], klass: '주로 그람양성·음성균에 작용하는 것', welfare: '618', basePrice: 330 },
  { stem: '아모클라', form: '정', ingredient: '아목시실린수화물·클라불란산칼륨', strengths: ['375mg', '625mg'], klass: '주로 그람양성·음성균에 작용하는 것', welfare: '618', basePrice: 450 },
  { stem: '레보신', form: '정', ingredient: '레보플록사신수화물', strengths: ['100mg', '250mg', '500mg'], klass: '합성항균제', welfare: '629', basePrice: 510 },
  { stem: '록소엔', form: '정', ingredient: '록소프로펜나트륨수화물', strengths: ['60mg'], klass: '해열·진통·소염제', welfare: '114', basePrice: 80 },
  { stem: '세레원', form: '캡슐', ingredient: '세레콕시브', strengths: ['100mg', '200mg'], klass: '해열·진통·소염제', welfare: '114', basePrice: 350 },
  { stem: '아세론', form: '정', ingredient: '아세클로페낙', strengths: ['100mg'], klass: '해열·진통·소염제', welfare: '114', basePrice: 150 },
  { stem: '클로엔', form: '정', ingredient: '클로피도그렐황산수소염', strengths: ['75mg'], klass: '기타의 혈액 및 체액용약', welfare: '339', basePrice: 690 },
  { stem: '에제온', form: '정', ingredient: '에제티미브', strengths: ['10mg'], klass: '동맥경화용제', welfare: '218', basePrice: 560 },
  { stem: '몬테원', form: '필름코팅정', ingredient: '몬테루카스트나트륨', strengths: ['5mg', '10mg'], klass: '기타의 호흡기관용약', welfare: '229', basePrice: 470 },
  { stem: '레보티진', form: '정', ingredient: '레보세티리진염산염', strengths: ['5mg'], klass: '항히스타민제', welfare: '141', basePrice: 170 },
  { stem: '프레가엔', form: '캡슐', ingredient: '프레가발린', strengths: ['25mg', '75mg', '150mg'], klass: '기타의 중추신경용약', welfare: '119', basePrice: 400 },
  { stem: '가바온', form: '캡슐', ingredient: '가바펜틴', strengths: ['100mg', '300mg'], klass: '항전간제', welfare: '113', basePrice: 210 },
  { stem: '에페온', form: '정', ingredient: '에페리손염산염', strengths: ['50mg'], klass: '골격근이완제', welfare: '122', basePrice: 70 },
  { stem: '탐스원', form: '캡슐', ingredient: '탐스로신염산염', strengths: ['0.2mg'], klass: '기타의 비뇨생식기관 및 항문용약', welfare: '259', basePrice: 300 },
  { stem: '피나엔', form: '필름코팅정', ingredient: '피나스테리드', strengths: ['1mg', '5mg'], klass: '기타의 비뇨생식기관 및 항문용약', welfare: '259', basePrice: 640, nonCovered: true },
  { stem: '도네온', form: '필름코팅정', ingredient: '도네페질염산염', strengths: ['5mg', '10mg'], klass: '기타의 중추신경용약', welfare: '119', basePrice: 880 },
  { stem: '콜린엔', form: '캡슐', ingredient: '콜린알포세레이트', strengths: ['400mg'], klass: '기타의 순환계용약', welfare: '219', basePrice: 480 },
  { stem: '은행원', form: '정', ingredient: '은행엽건조엑스', strengths: ['40mg', '80mg'], klass: '기타의 순환계용약', welfare: '219', basePrice: 130 },
  { stem: '타이펜', form: '정', ingredient: '아세트아미노펜', strengths: ['500mg', '650mg'], klass: '해열·진통·소염제', welfare: '114', basePrice: 50, otc: true },
  { stem: '코푸원', form: '시럽', ingredient: '디히드로코데인타르타르산염·클로르페니라민말레산염', strengths: ['100mL'], klass: '진해거담제', welfare: '222', basePrice: 1800 },
  { stem: '비타온', form: '정', ingredient: '푸르설티아민·리보플라빈·피리독신염산염', strengths: ['100mg'], klass: '혼합비타민제', welfare: '317', basePrice: 0, otc: true, nonCovered: true },
];

const ADDITIVES: Record<MedicineBase['form'], string> = {
  정: '유당수화물, 미결정셀룰로오스, 크로스카르멜로오스나트륨, 스테아르산마그네슘',
  필름코팅정: '미결정셀룰로오스, 히프로멜로오스, 산화티탄, 폴리에틸렌글리콜, 스테아르산마그네슘',
  서방정: '히프로멜로오스, 카르복시메틸셀룰로오스나트륨, 스테아르산마그네슘',
  캡슐: '유당수화물, 옥수수전분, 젤라틴, 산화티탄',
  시럽: '백당, 정제수, 파라옥시벤조산메틸, 향료',
};

function packingFor(form: MedicineBase['form'], i: number): string {
  if (form === '시럽') return '100mL/병';
  if (form === '캡슐') return i % 2 === 0 ? '30캡슐/병' : '10캡슐x10/PTP';
  const options = ['30정/병', '100정/병', '10정x3/PTP', '10정x10/PTP', '500정/병'];
  return options[i % options.length];
}

const pad = (n: number, len: number) => String(n).padStart(len, '0');

function buildMedicines(): MedicineDetail[] {
  const list: MedicineDetail[] = [];
  let seq = 0;
  const variants: { base: MedicineBase; baseIndex: number; strength: string; strengthIndex: number; generic: boolean }[] = [];
  BASES.forEach((base, baseIndex) => {
    base.strengths.forEach((strength, strengthIndex) => {
      variants.push({ base, baseIndex, strength, strengthIndex, generic: false });
      // 같은 성분을 다른 제약사도 판매하는 경우(회사명 + 제품명)
      if (baseIndex % 2 === 0) variants.push({ base, baseIndex, strength, strengthIndex, generic: true });
    });
  });
  for (const { base, baseIndex, strength, strengthIndex, generic } of variants) {
    seq += 1;
    const companyIndex = (baseIndex * 3 + strengthIndex + (generic ? 5 : 0)) % COMPANIES.length;
    const company = COMPANIES[companyIndex];
    const prefix = generic ? company.replace(/(제약|약품|바이오팜|바이오|헬스케어|팜)$/u, '') : '';
    let name = `${prefix}${base.stem}${base.form}${strength}`;
    // 실제 데이터처럼 일부 이름 앞에 표식이 붙어 있다 (정렬 시 무시)
    if (seq % 29 === 0) name = `[NP]${name}`;
    else if (seq % 37 === 0) name = `★${name}`;
    const code = `6${pad(companyIndex + 1, 2)}${pad(4000 + seq * 7, 5)}${strengthIndex}`.slice(0, 9);
    const unpriced = seq % 23 === 0;
    const price = base.basePrice > 0 && !unpriced ? Math.round(base.basePrice * (1 + strengthIndex * 0.55)) : null;
    const priceText = price !== null ? price.toLocaleString('ko-KR') : '미정';
    const feeValue = seq % 5 === 0 ? null : `${30 + (seq % 6) * 5}%`;
    list.push({
      code,
      name,
      company,
      packing: packingFor(base.form, seq),
      ingredient: `${base.ingredient} ${strength}`,
      priceText,
      price,
      fee: feeValue ? { label: '수수료', value: feeValue } : null,
      inHouse: company === 'CKP제약',
      imageUrl: null,
      type1: base.otc ? '일반' : '전문',
      type2: base.nonCovered ? '비급여' : '급여',
      medicineClass: base.klass,
      welfareCode: base.welfare,
      contrastMedicine: seq % 4 === 0 ? `${base.stem}오리지널${base.form}${strength}` : null,
      additives: ADDITIVES[base.form],
      note: seq % 9 === 0 ? '실온(1~30℃) 보관, 차광 밀폐용기' : null,
      settlement: seq % 17 === 0 ? 'N' : 'Y',
      regYmd: `2025-${pad((seq % 12) + 1, 2)}-${pad((seq % 27) + 1, 2)}`,
    });
  }
  return list;
}

export const SAMPLE_MEDICINES: MedicineDetail[] = buildMedicines();

/** 이름 정렬 키: 앞쪽 표식([..], ◎, ★, 공백) 제거 */
export function medicineSortKey(name: string): string {
  return name.trim().replace(/^(\[[^\]]*\]|◎|★|\s)+/u, '');
}
