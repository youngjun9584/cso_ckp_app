import { Platform } from 'react-native';

/**
 * 웹(react-native-web)에서만 의미가 있는 aria 속성 (aria-level, aria-current, aria-describedby 등).
 * RN 네이티브에는 없는 prop 이므로 네이티브에서는 넘기지 않는다.
 */
export function webOnly(props: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  return Platform.OS === 'web' ? props : {};
}
