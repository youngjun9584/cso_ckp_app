import type { PressableStateCallbackType } from 'react-native';

/** react-native-web 은 Pressable 상태에 hovered/focused 를 추가로 넘긴다 (RN 타입에는 없음) */
export type InteractionState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

export function asInteraction(state: PressableStateCallbackType): InteractionState {
  return state as InteractionState;
}
