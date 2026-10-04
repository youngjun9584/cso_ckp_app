import type { IconName } from '@/components/ui/Icon';

export type AppTabName = 'home' | 'medicines' | 'notices' | 'edi' | 'clients';

export interface AppTab {
  /** (app) 아래 라우트 이름 */
  name: AppTabName;
  href: '/home' | '/medicines' | '/notices' | '/edi' | '/clients';
  label: string;
  icon: IconName;
  iconActive: IconName;
}

/** 탭 순서: 홈 · 의약품 · 공지사항 · EDI 등록 · 거래처 (DESIGN §6.1) */
export const APP_TABS: readonly AppTab[] = [
  { name: 'home', href: '/home', label: '홈', icon: 'home-outline', iconActive: 'home' },
  { name: 'medicines', href: '/medicines', label: '의약품', icon: 'medkit-outline', iconActive: 'medkit' },
  { name: 'notices', href: '/notices', label: '공지사항', icon: 'megaphone-outline', iconActive: 'megaphone' },
  { name: 'edi', href: '/edi', label: 'EDI 등록', icon: 'images-outline', iconActive: 'images' },
  { name: 'clients', href: '/clients', label: '거래처', icon: 'business-outline', iconActive: 'business' },
];

/** 로그인 후·'/' 의 첫 화면 */
export const HOME_HREF = '/home' as const;
