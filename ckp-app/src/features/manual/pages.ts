/**
 * 앱 사용 메뉴얼 — 화면별 스크린샷 + 설명.
 * 스크린샷은 assets/manual/<이름>.png(모바일 390×844 @2x) 와 <이름>-wide.png(넓은 웹 1280×800 @1.5x).
 * 촬영은 샘플 모드 웹에서 자동으로 했으며(샘플 데이터), 화면이 바뀌면 다시 촬영해 교체한다.
 */
import type { ImageSourcePropType } from 'react-native';
import type { Href } from 'expo-router';

import type { IconName } from '@/components/ui/Icon';
import type { AppTabName } from '@/components/shell/tabs';

export type ManualPageKey =
  | 'login'
  | 'signup'
  | 'home'
  | 'medicines'
  | 'medicine-detail'
  | 'notices'
  | 'notice-detail'
  | 'edi'
  | 'edi-new'
  | 'edi-detail'
  | 'clients'
  | 'client-new'
  | 'client-detail'
  | 'account';

export interface ManualShot {
  /** 모바일(세로) 스크린샷 */
  mobile: ImageSourcePropType;
  /** 넓은 웹 스크린샷 (없으면 모바일 것을 보여준다) */
  wide?: ImageSourcePropType;
  /** 스크린리더용 설명 */
  alt: string;
}

export interface ManualSection {
  /** 소제목 (단계가 여러 개인 화면에서 사용) */
  title?: string;
  shot?: ManualShot;
  /** 스크린샷 아래 설명 (한 항목 = 한 줄, 번호 순서대로 표시) */
  steps: string[];
  /** 알아두면 좋은 점 */
  tips?: string[];
}

export interface ManualPage {
  key: ManualPageKey;
  title: string;
  /** 목록에서 묶는 기준 (탭 이름 또는 '시작하기') */
  group: '시작하기' | '홈' | '의약품' | '공지사항' | 'EDI 등록' | '거래처' | '계정';
  icon: IconName;
  /** 목록·상단 한 줄 요약 */
  summary: string;
  sections: ManualSection[];
  /** 실제 화면으로 이동 (로그인 후 화면만) */
  href?: Href;
}

/** 모바일 스크린샷 비율 (390×844) */
export const SHOT_ASPECT_MOBILE = 390 / 844;
/** 넓은 웹 스크린샷 비율 (1280×800) */
export const SHOT_ASPECT_WIDE = 1280 / 800;

const shot = (mobile: ImageSourcePropType, wide: ImageSourcePropType, alt: string): ManualShot => ({ mobile, wide, alt });

export const MANUAL_PAGES: readonly ManualPage[] = [
  {
    key: 'login',
    title: '로그인',
    group: '시작하기',
    icon: 'log-in-outline',
    summary: '아이디와 비밀번호로 앱에 들어갑니다.',
    sections: [
      {
        shot: shot(require('../../../assets/manual/login.png'), require('../../../assets/manual/login-wide.png'), '로그인 화면: 아이디·비밀번호 입력란과 로그인 버튼'),
        steps: [
          '아이디와 비밀번호를 입력하고 로그인 버튼을 누릅니다.',
          '눈 모양 아이콘을 누르면 입력한 비밀번호를 확인할 수 있습니다.',
          '계정이 없으면 회원가입 버튼으로 가입을 신청합니다.',
          '오른쪽 위 물음표(?) 아이콘을 누르면 계정 문의 안내가 나옵니다. 계정 발급·비밀번호 초기화는 관리자에게 문의합니다.',
        ],
        tips: [
          '관리자 승인 전이거나 접속이 차단된 계정은 로그인할 수 없으며, 화면에 사유가 표시됩니다.',
          '로그인에 여러 번 실패하면 잠시 후 다시 시도해야 합니다.',
        ],
      },
    ],
  },
  {
    key: 'signup',
    title: '회원가입',
    group: '시작하기',
    icon: 'person-add-outline',
    summary: '새 계정을 신청합니다. 관리자 승인 후 로그인할 수 있습니다.',
    sections: [
      {
        shot: shot(require('../../../assets/manual/signup.png'), require('../../../assets/manual/signup-wide.png'), '회원가입 화면: 아이디, 비밀번호, 이름, 휴대폰 등 입력란'),
        steps: [
          '아이디(2~20자)를 입력하고 중복 확인 버튼으로 사용할 수 있는 아이디인지 확인합니다.',
          '비밀번호(4자 이상)를 입력하고 같은 값을 비밀번호 확인란에 다시 입력합니다.',
          '이름과 휴대폰 번호는 필수, 이메일과 회사명은 선택입니다.',
          '개인정보 수집·이용 동의에 체크한 뒤 가입 신청 버튼을 누릅니다.',
          '신청이 끝나면 관리자가 승인한 뒤부터 로그인할 수 있습니다.',
        ],
        tips: ['별표(*)가 붙은 항목은 필수입니다. 잘못 입력한 항목은 입력란 아래에 빨간 안내가 표시됩니다.'],
      },
    ],
  },
  {
    key: 'home',
    title: '홈',
    group: '홈',
    icon: 'home-outline',
    summary: '로그인 후 첫 화면입니다. 자주 쓰는 업무로 바로 이동합니다.',
    href: '/home',
    sections: [
      {
        shot: shot(require('../../../assets/manual/home.png'), require('../../../assets/manual/home-wide.png'), '홈 화면: 인사말, 새 EDI 등록 카드, 의약품 검색, 자주 쓰는 업무 바로가기'),
        steps: [
          '새 EDI 등록 버튼을 누르면 EDI 사진 등록을 바로 시작합니다.',
          '“어떤 의약품을 찾으세요?” 를 누르면 의약품 검색 화면이 열립니다.',
          '자주 쓰는 업무에서 EDI 등록·의약품·거래처·공지사항 화면으로 이동할 수 있습니다.',
          '아래 탭(넓은 화면에서는 왼쪽 메뉴)으로 언제든 다른 화면으로 옮겨 갈 수 있습니다.',
          '오른쪽 위 사람 아이콘은 계정 화면, 물음표(?) 아이콘은 지금 보고 있는 화면의 메뉴얼을 엽니다.',
        ],
        tips: ['EDI 등록을 작성하던 중에 다른 화면으로 이동해도 작성 내용은 유지됩니다. 로그아웃하면 지워집니다.'],
      },
    ],
  },
  {
    key: 'medicines',
    title: '의약품 목록',
    group: '의약품',
    icon: 'medkit-outline',
    summary: '의약품을 검색하고 약가·수수료를 확인합니다.',
    href: '/medicines',
    sections: [
      {
        shot: shot(require('../../../assets/manual/medicines.png'), require('../../../assets/manual/medicines-wide.png'), '의약품 목록 화면: 검색창, 검색 기준, 보기 방식, 의약품 카드 목록'),
        steps: [
          '검색창에 낱말을 입력하면 잠시 후 자동으로 검색됩니다. 검색 기준(의약품명·제약사·보험코드·전체)을 바꿔 찾을 수도 있습니다.',
          '보기 방식에서 카드 또는 표를 고릅니다. 표에서는 제품명·제약사·포장·보험코드·약가·수수료·대조의약품을 한 번에 봅니다.',
          '목록을 아래로 내리면 다음 의약품이 이어서 불러와집니다. 위에 전체 건수가 표시됩니다.',
          '의약품을 누르면 상세 화면으로 이동합니다.',
        ],
        tips: ['자사생산 배지는 CKP 제약이 직접 생산하는 품목입니다.', '검색 결과가 없으면 다른 낱말이나 검색 기준으로 다시 찾아보세요.'],
      },
    ],
  },
  {
    key: 'medicine-detail',
    title: '의약품 상세',
    group: '의약품',
    icon: 'document-text-outline',
    summary: '한 의약품의 기본 정보, 성분·분류, 가격·정산 정보를 봅니다.',
    sections: [
      {
        shot: shot(require('../../../assets/manual/medicine-detail.png'), require('../../../assets/manual/medicine-detail-wide.png'), '의약품 상세 화면: 기본 정보, 성분·분류, 가격·정산, 비고'),
        steps: [
          '기본 정보에서 제약사, 포장·규격, 보험코드 등을 확인합니다.',
          '가격·정산에서 약가, 수수료, 정산 여부를 확인합니다.',
          '값이 없는 항목은 표시되지 않습니다.',
          '왼쪽 위 뒤로(<) 버튼이나 아래 탭을 눌러 목록으로 돌아갑니다.',
        ],
      },
    ],
  },
  {
    key: 'notices',
    title: '공지사항 목록',
    group: '공지사항',
    icon: 'megaphone-outline',
    summary: '회사에서 올린 공지와 업무 안내를 확인합니다.',
    href: '/notices',
    sections: [
      {
        shot: shot(require('../../../assets/manual/notices.png'), require('../../../assets/manual/notices-wide.png'), '공지사항 목록 화면: 검색창, 중요 공지 배지가 달린 공지 목록'),
        steps: [
          '중요 공지는 중요 배지와 함께 목록 맨 위에 고정됩니다.',
          '검색창에 제목의 일부를 입력하면 해당 공지만 보여 줍니다.',
          '공지를 누르면 상세 내용이 열립니다.',
          '새로고침 버튼으로 최신 공지를 다시 불러올 수 있습니다.',
        ],
      },
    ],
  },
  {
    key: 'notice-detail',
    title: '공지 상세',
    group: '공지사항',
    icon: 'reader-outline',
    summary: '공지 제목, 작성일, 본문과 첨부파일을 봅니다.',
    sections: [
      {
        shot: shot(require('../../../assets/manual/notice-detail.png'), require('../../../assets/manual/notice-detail-wide.png'), '공지 상세 화면: 제목, 작성일, 본문'),
        steps: [
          '본문의 이미지는 화면 폭에 맞춰 표시됩니다. 이미지를 누르면 크게 볼 수 있습니다.',
          '본문의 링크를 누르면 브라우저(또는 전화·메일 앱)가 열립니다.',
          '첨부파일이 있으면 본문 아래 첨부파일 목록에서 열 수 있습니다.',
          '새로고침 버튼으로 최신 내용을 다시 불러옵니다.',
        ],
      },
    ],
  },
  {
    key: 'edi',
    title: 'EDI 등록 내역',
    group: 'EDI 등록',
    icon: 'images-outline',
    summary: '등록한 EDI 사진 건을 달별로 확인하고 새 등록을 시작합니다.',
    href: '/edi',
    sections: [
      {
        shot: shot(require('../../../assets/manual/edi.png'), require('../../../assets/manual/edi-wide.png'), 'EDI 등록 내역 화면: 달 이동, 새 EDI 등록 버튼, 제출 건 카드 목록'),
        steps: [
          '위의 ◀ ▶ 버튼으로 등록한 달을 옮겨 가며 내역을 봅니다.',
          '각 카드에는 거래처, 대상월, 사진 수, 등록 시각, 처리 상태(검토필요·검토완료·삭제요청 등)가 표시됩니다.',
          '카드를 누르면 사진과 처리 상태를 자세히 볼 수 있습니다.',
          '새 EDI 등록 버튼을 누르면 3단계 등록이 시작됩니다.',
        ],
        tips: ['상태 배지 수는 사진 장수 기준입니다. 예: 검토필요 4장, 검토완료 2장.'],
      },
    ],
  },
  {
    key: 'edi-new',
    title: '새 EDI 등록',
    group: 'EDI 등록',
    icon: 'cloud-upload-outline',
    summary: '거래처 선택 → 사진 선택·순서 → 확인·등록의 3단계로 EDI 사진을 제출합니다.',
    href: '/edi/new',
    sections: [
      {
        title: '1단계 · 기본 정보',
        shot: shot(require('../../../assets/manual/edi-new-1.png'), require('../../../assets/manual/edi-new-1-wide.png'), '새 EDI 등록 1단계: 거래처 선택 버튼, 대상 연월 선택'),
        steps: [
          '거래처 선택 버튼을 눌러 내 거래처 목록에서 EDI를 등록할 거래처를 고릅니다. 승인 대기 중인 거래처는 선택할 수 없습니다.',
          '대상 연월(당월·전월·전전월)을 고릅니다. 기본은 당월입니다.',
          '다음 · 사진 선택 버튼으로 2단계로 넘어갑니다.',
        ],
        tips: ['관리자가 EDI 등록을 막아 둔 상태면 화면 위에 안내가 표시되고 다음 단계로 갈 수 없습니다.'],
      },
      {
        title: '거래처 고르기',
        shot: shot(require('../../../assets/manual/edi-new-1-picker.png'), require('../../../assets/manual/edi-new-1-picker-wide.png'), '거래처 선택 목록: 검색창과 거래처 목록'),
        steps: ['거래처명으로 검색해 목록을 줄일 수 있습니다.', '거래처를 누르면 바로 선택되고 1단계 화면으로 돌아갑니다.'],
      },
      {
        title: '2단계 · 사진 선택·순서',
        shot: shot(require('../../../assets/manual/edi-new-2.png'), require('../../../assets/manual/edi-new-2-wide.png'), '새 EDI 등록 2단계: 선택한 사진 격자와 번호, 추가·촬영 버튼'),
        steps: [
          '앨범에서 선택(컴퓨터 웹에서는 사진 파일 선택) 또는 카메라로 촬영 버튼으로 처방전·거래명세서 사진을 가져옵니다. 한 건에 최대 30장까지 넣을 수 있습니다.',
          '가져온 순서대로 번호가 붙습니다. 사진을 길게 눌러 끌거나 ‹ › 버튼으로 순서를 바꿀 수 있습니다.',
          '사진을 누르면 크게 볼 수 있고, × 버튼으로 뺄 수 있습니다. 모두 제거 버튼은 전체를 비웁니다.',
          '격자 보기·목록 보기를 바꿔 파일명·크기를 확인하거나 버튼으로 순서를 옮길 수 있습니다.',
          '다음 · 확인 버튼으로 3단계로 넘어갑니다. 사진 처리가 끝날 때까지 버튼에 처리 중 장수가 표시됩니다.',
        ],
        tips: [
          '사진은 가져오는 즉시 크기를 줄여(긴 변 2560px) 저장하므로 큰 원본도 그대로 선택해도 됩니다.',
          '남은 장수보다 많이 선택하면 어떤 사진을 넣을지 묻는 안내가 나오며, 사진을 조용히 버리지 않습니다.',
          '컴퓨터 웹에서는 사진 파일을 끌어다 놓아도 추가됩니다.',
        ],
      },
      {
        title: '3단계 · 확인·등록',
        shot: shot(require('../../../assets/manual/edi-new-3.png'), require('../../../assets/manual/edi-new-3-wide.png'), '새 EDI 등록 3단계: 등록 내용 요약, 등록 순서 썸네일, 등록 버튼'),
        steps: [
          '거래처, 대상 연월, 사진 수와 최종 순서를 확인합니다. 순서를 바꾸려면 이전 버튼으로 돌아갑니다.',
          '사진 N장 등록하기 버튼을 누르면 사진이 올라가고 등록이 완료됩니다. 진행률이 사진마다 표시됩니다.',
          '일부 사진이 실패하면 실패한 사진만 다시 시도 버튼으로 그 사진만 다시 보냅니다.',
          '완료 화면에서 등록 내역 확인 또는 새로 작성하기를 고릅니다.',
        ],
        tips: [
          '업로드 중에는 앱을 종료하지 마세요. 다른 화면으로 이동해도 업로드는 계속됩니다.',
          '같은 건을 두 번 눌러도 중복 등록되지 않도록 서버가 확인합니다.',
        ],
      },
    ],
  },
  {
    key: 'edi-detail',
    title: 'EDI 등록 상세',
    group: 'EDI 등록',
    icon: 'albums-outline',
    summary: '제출한 건의 사진과 처리 상태를 확인합니다.',
    sections: [
      {
        shot: shot(require('../../../assets/manual/edi-detail.png'), require('../../../assets/manual/edi-detail-wide.png'), 'EDI 등록 상세 화면: 요약 카드와 번호가 붙은 사진 격자'),
        steps: [
          '위 요약에서 거래처, 대상월, 등록 시각, 사진 수, 상태를 확인합니다.',
          '사진은 등록한 순서대로 번호와 함께 표시됩니다. 누르면 크게 보고 좌우로 넘길 수 있습니다.',
          '사진마다 처리 상태(검토필요·검토완료·삭제요청·삭제됨)가 배지로 표시됩니다.',
          '새로 고침 버튼으로 최신 처리 상태를 다시 불러옵니다.',
        ],
      },
    ],
  },
  {
    key: 'clients',
    title: '거래처 목록',
    group: '거래처',
    icon: 'business-outline',
    summary: '내 거래처를 검색하고 새 거래처를 등록합니다.',
    href: '/clients',
    sections: [
      {
        shot: shot(require('../../../assets/manual/clients.png'), require('../../../assets/manual/clients-wide.png'), '거래처 목록 화면: 검색창, 승인 배지가 달린 거래처 카드, 거래처 등록 버튼'),
        steps: [
          '검색창에 거래처명·대표자·주소·전화번호·사업자등록번호 일부를 입력해 찾습니다.',
          '카드의 배지로 승인 상태(승인·승인 대기)를 확인합니다. 승인된 거래처만 EDI 등록에 쓸 수 있습니다.',
          '카드를 누르면 상세 화면이 열립니다.',
          '거래처 등록 버튼을 눌러 새 거래처를 등록합니다.',
        ],
      },
    ],
  },
  {
    key: 'client-new',
    title: '거래처 등록',
    group: '거래처',
    icon: 'add-circle-outline',
    summary: '새 거래처 정보를 입력해 등록을 신청합니다.',
    href: '/clients/new',
    sections: [
      {
        shot: shot(require('../../../assets/manual/client-new.png'), require('../../../assets/manual/client-new-wide.png'), '거래처 등록 화면: 기본 정보, 주소, 추가 정보 입력란과 등록 버튼'),
        steps: [
          '거래처명(필수)을 입력하고 거래처 구분(의원·병원·종합병원·요양병원·약국·기타·직접 입력)을 고릅니다.',
          '사업자등록번호와 연락처는 숫자만 입력하면 하이픈(-)이 자동으로 들어갑니다. 사업자등록번호는 입력을 마치면 중복 여부를 확인합니다.',
          '주소, 요양기관번호, 문전약국, 메모(방문 요일·담당 직원 등)는 필요할 때 입력합니다.',
          '아래 거래처 등록 버튼을 누르면 저장되고 상세 화면으로 이동합니다.',
        ],
        tips: [
          '잘못 입력한 항목은 입력란 아래에 빨간 안내가 표시됩니다.',
          '관리자 승인이 필요한 설정이면 승인 후부터 EDI 등록에 사용할 수 있습니다.',
          '작성 중 뒤로 가면 입력한 내용을 버릴지 확인합니다.',
        ],
      },
    ],
  },
  {
    key: 'client-detail',
    title: '거래처 상세',
    group: '거래처',
    icon: 'storefront-outline',
    summary: '거래처 정보를 확인하고 이 거래처로 EDI 등록을 시작합니다.',
    sections: [
      {
        shot: shot(require('../../../assets/manual/client-detail.png'), require('../../../assets/manual/client-detail-wide.png'), '거래처 상세 화면: 거래처 정보 목록과 이 거래처로 EDI 등록 버튼'),
        steps: [
          '거래처 구분, 대표자명, 연락처, 주소, 사업자등록번호 등 등록된 정보를 확인합니다.',
          '전화 걸기 버튼으로 바로 전화를 걸 수 있습니다(전화가 되는 기기에서).',
          '이 거래처로 EDI 등록 버튼을 누르면 거래처가 미리 선택된 상태로 새 EDI 등록이 열립니다.',
          '승인 대기 중인 거래처는 안내가 표시되고 EDI 등록 버튼이 보이지 않습니다.',
        ],
      },
    ],
  },
  {
    key: 'account',
    title: '계정',
    group: '계정',
    icon: 'person-circle-outline',
    summary: '내 정보와 연결된 서버를 확인하고 로그아웃합니다.',
    href: '/account',
    sections: [
      {
        shot: shot(require('../../../assets/manual/account.png'), require('../../../assets/manual/account-wide.png'), '계정 화면: 사용자 정보, 연결 정보, 로그아웃 버튼'),
        steps: [
          '아이디, 이름, 회사, 연락처, 이메일을 확인합니다. 정보 수정은 관리자에게 요청합니다.',
          '연결 정보에서 어떤 서버(운영·개발·샘플)에 연결되어 있는지와 앱 버전을 확인합니다.',
          '로그아웃 버튼을 누르면 확인 후 로그인 화면으로 돌아갑니다.',
        ],
        tips: ['작성 중인 EDI 등록 건이 있으면 로그아웃할 때 함께 지워진다고 안내합니다.'],
      },
    ],
  },
];

export const MANUAL_GROUPS: readonly ManualPage['group'][] = ['시작하기', '홈', '의약품', '공지사항', 'EDI 등록', '거래처', '계정'];

export function findManualPage(key: string | undefined): ManualPage | undefined {
  return MANUAL_PAGES.find((page) => page.key === key);
}

/** 현재 경로(usePathname)에 맞는 메뉴얼 페이지. 메뉴얼 안이거나 모르는 경로면 null */
export function manualPageForPath(pathname: string): ManualPageKey | null {
  const [, root, second] = pathname.split('/');
  switch (root as AppTabName | 'account' | 'login' | 'signup' | 'manual' | undefined) {
    case 'home':
      return 'home';
    case 'medicines':
      return second ? 'medicine-detail' : 'medicines';
    case 'notices':
      return second ? 'notice-detail' : 'notices';
    case 'edi':
      return !second ? 'edi' : second === 'new' ? 'edi-new' : 'edi-detail';
    case 'clients':
      return !second ? 'clients' : second === 'new' ? 'client-new' : 'client-detail';
    case 'account':
      return 'account';
    case 'login':
      return 'login';
    case 'signup':
      return 'signup';
    default:
      return null;
  }
}

export function manualHref(key: ManualPageKey | null): Href {
  return key ? ({ pathname: '/manual/[page]', params: { page: key } } as Href) : '/manual';
}
