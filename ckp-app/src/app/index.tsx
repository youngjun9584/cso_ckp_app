import { Redirect } from 'expo-router';

import { HOME_HREF } from '@/components/shell/tabs';

/** '/' → 첫 화면(홈 · 메인 메뉴) */
export default function Index() {
  return <Redirect href={HOME_HREF} />;
}
