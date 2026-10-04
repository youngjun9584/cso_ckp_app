/**
 * 탭 바 밖(홈 바로가기 등)에서 탭을 여는 도우미. 탭 바와 같이 먼저 confirmLeave() 로 작성 중 화면의 확인을 받는다.
 * tabs 는 (app) 탭 내비게이터 — 탭 안 화면에서 useNavigation().getParent() 로 얻는다.
 */
import { router, type Href } from 'expo-router';
import { StackActions, type NavigationProp, type ParamListBase } from 'expo-router/react-navigation';

import { confirmLeave, type ConfirmLeaveOptions } from '@/lib/navigation-guard';
import type { AppTab } from './tabs';

export type TabsNavigation = NavigationProp<ParamListBase>;

/**
 * 탭의 첫 화면(목록)으로 이동한다. 그 탭에 상세 등이 쌓여 있으면 첫 화면까지 되돌린다.
 * (router.navigate('/medicines') 는 상세 위에 목록을 한 번 더 쌓으므로 쓰지 않는다)
 */
export async function openTabRoot(tabs: TabsNavigation | undefined, tab: AppTab): Promise<boolean> {
  if (!(await confirmLeave())) return false;
  const route = tabs?.getState()?.routes.find((r) => r.name === tab.name);
  if (!tabs || !route) {
    router.navigate(tab.href);
    return true;
  }
  const nested = route.state;
  if (nested?.key && (nested.index ?? 0) > 0) {
    // 탭 바의 "같은 탭 다시 누르기"와 같은 동작 — EDI 작성 화면은 POP_TO_TOP 을 다시 묻지 않는다(위에서 이미 확인)
    tabs.dispatch({ ...StackActions.popToTop(), target: nested.key });
  }
  tabs.navigate(route.name);
  return true;
}

/**
 * 탭 안의 특정 화면을 연다. 그 탭 스택에 같은 화면이 이미 있으면 새로 쌓지 않고 그 화면으로 돌아간다(pop),
 * 없으면 탭 첫 화면 위에 연다(뒤로 가면 탭 첫 화면).
 *   openTabScreen(tabs, 'edi', 'new', '/edi/new', { ignore: ['edi-new-draft'] })
 */
export async function openTabScreen(
  tabs: TabsNavigation | undefined,
  tabName: AppTab['name'],
  screen: string,
  href: Href,
  options?: ConfirmLeaveOptions,
): Promise<boolean> {
  if (!(await confirmLeave(options))) return false;
  if (!tabs?.getState()?.routes.some((r) => r.name === tabName)) {
    router.navigate(href, { withAnchor: true });
    return true;
  }
  // initial:false → 탭을 처음 여는 경우에도 첫 화면(목록)을 아래에 둔다 / pop:true → 이미 있으면 그 화면으로 돌아간다
  tabs.navigate(tabName, { screen, initial: false, pop: true });
  return true;
}
