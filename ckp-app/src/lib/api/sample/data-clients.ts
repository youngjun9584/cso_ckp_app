/** 샘플 거래처 (가상의 병·의원/약국). 사업자등록번호는 검증번호가 맞도록 계산한다. */
import type { ClientApproval, ClientDetail } from '../contract';
import { formatBizNo } from '@/lib/format';

/** 앞 9자리로 검증번호를 계산해 10자리 사업자등록번호를 만든다 */
export function withBizNoCheckDigit(first9: string): string {
  const nums = first9.split('').map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += nums[i] * weights[i];
  sum += Math.floor((nums[8] * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return `${first9}${check}`;
}

interface ClientSeed {
  name: string;
  clientType: string;
  representative: string;
  bizNo9: string | null;
  address: string;
  zipCode: string;
  phone: string;
  careCode: string | null;
  dispensary: string | null;
  memo: string | null;
  approval: ClientApproval;
}

const SEEDS: ClientSeed[] = [
  { name: '서울바른내과의원', clientType: '의원', representative: '김민준', bizNo9: '214861203', address: '서울특별시 강남구 테헤란로 152, 3층', zipCode: '06236', phone: '02-555-1234', careCode: '11358001', dispensary: '바른온누리약국', memo: '매주 화요일 오전 방문', approval: 'approved' },
  { name: '한빛정형외과의원', clientType: '의원', representative: '이서연', bizNo9: '120812345', address: '서울특별시 송파구 올림픽로 300, 5층', zipCode: '05551', phone: '02-412-7788', careCode: '11359420', dispensary: '한빛약국', memo: null, approval: 'approved' },
  { name: '연세사랑소아청소년과의원', clientType: '의원', representative: '박지호', bizNo9: '305217788', address: '경기도 성남시 분당구 황새울로 200', zipCode: '13595', phone: '031-712-3456', careCode: '31204567', dispensary: null, memo: '원장님 오후 진료만', approval: 'approved' },
  { name: '미래이비인후과의원', clientType: '의원', representative: '최유진', bizNo9: '617039912', address: '부산광역시 해운대구 센텀중앙로 78', zipCode: '48058', phone: '051-744-9090', careCode: '21307781', dispensary: '센텀미소약국', memo: null, approval: 'approved' },
  { name: '온누리가정의학과의원', clientType: '의원', representative: '정하늘', bizNo9: '409125566', address: '광주광역시 서구 상무중앙로 110', zipCode: '61949', phone: '062-381-2200', careCode: '36101234', dispensary: null, memo: null, approval: 'approved' },
  { name: '푸른숲신경과의원', clientType: '의원', representative: '강도윤', bizNo9: '511904433', address: '대구광역시 수성구 달구벌대로 2450', zipCode: '42154', phone: '053-765-4321', careCode: '22505678', dispensary: '숲약국', memo: '신규 품목 소개 예정', approval: 'approved' },
  { name: '새봄산부인과의원', clientType: '의원', representative: '윤서아', bizNo9: '138275540', address: '경기도 수원시 영통구 광교중앙로 145', zipCode: '16508', phone: '031-8003-1200', careCode: '31108899', dispensary: null, memo: null, approval: 'unset' },
  { name: '다정한치과의원', clientType: '치과의원', representative: '임준서', bizNo9: '220348876', address: '서울특별시 마포구 월드컵북로 21, 2층', zipCode: '03993', phone: '02-332-5566', careCode: '11409987', dispensary: null, memo: null, approval: 'approved' },
  { name: '중앙힐링요양병원', clientType: '요양병원', representative: '한지민', bizNo9: '314812299', address: '대전광역시 서구 둔산대로 117', zipCode: '35203', phone: '042-488-7000', careCode: '34100123', dispensary: '둔산중앙약국', memo: '약제부 박 팀장님 담당', approval: 'approved' },
  { name: '밝은안과의원', clientType: '의원', representative: '오세훈', bizNo9: '107883120', address: '서울특별시 영등포구 여의대로 108', zipCode: '07335', phone: '02-783-0101', careCode: '11701234', dispensary: null, memo: null, approval: 'pending' },
  { name: '행복한피부과의원', clientType: '의원', representative: '서예린', bizNo9: '211567743', address: '서울특별시 서초구 강남대로 373', zipCode: '06621', phone: '02-3481-2525', careCode: null, dispensary: null, memo: '승인 요청함 (9/20)', approval: 'pending' },
  { name: '우리동네약국', clientType: '약국', representative: '문가은', bizNo9: '603449871', address: '경상남도 창원시 성산구 중앙대로 90', zipCode: '51497', phone: '055-266-3377', careCode: '38200456', dispensary: null, memo: null, approval: 'approved' },
  { name: '튼튼재활의학과의원', clientType: '의원', representative: '장우진', bizNo9: '124378802', address: '인천광역시 연수구 컨벤시아대로 165', zipCode: '21998', phone: '032-858-1004', careCode: '12309876', dispensary: '송도튼튼약국', memo: null, approval: 'approved' },
  { name: '성모365내과의원', clientType: '의원', representative: '백승현', bizNo9: null, address: '울산광역시 남구 삼산로 274', zipCode: '44707', phone: '052-275-3650', careCode: '26100365', dispensary: null, memo: '사업자번호 확인 필요', approval: 'approved' },
];

export function buildSampleClients(ownerUsrId: string, requireApproval: boolean): ClientDetail[] {
  return SEEDS.map((seed, i) => ({
    idx: 5000 + i + 1,
    name: seed.name,
    clientType: seed.clientType,
    representative: seed.representative,
    bizNo: seed.bizNo9 ? formatBizNo(withBizNoCheckDigit(seed.bizNo9)) : null,
    address: seed.address,
    phone: seed.phone,
    approval: seed.approval,
    selectableForEdi: requireApproval ? seed.approval !== 'pending' : true,
    zipCode: seed.zipCode,
    careCode: seed.careCode,
    dispensary: seed.dispensary,
    memo: seed.memo,
    ownerUsrId,
  }));
}
