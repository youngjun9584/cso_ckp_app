/**
 * 뷰가 창 맨 위에서 얼마나 떨어져 있는지(창 기준 y) 잰다 — KeyboardAvoidingView 의 keyboardVerticalOffset 용.
 *
 * RN 의 KeyboardAvoidingView 는 자기 위치를 부모 기준(onLayout)으로 알고, 키보드 위치는 화면(창) 기준으로 받는다.
 * 그래서 부모가 창 맨 위가 아니면(AppHeader·샘플/개발 서버 띠·단계 표시 아래) 그 거리를 offset 으로 줘야
 * "창과 키보드가 겹치는 높이"만큼 정확히 올라간다. 측정할 View 를 KeyboardAvoidingView 의 바로 위 부모로 두면
 * KAV 의 frame.y 는 0 이 되고 offset = 이 값이 된다.
 *
 *   const windowTop = useWindowTop();
 *   <View collapsable={false} onLayout={windowTop.onLayout} style={{ flex: 1 }}>
 *     <KeyboardAvoidingView keyboardVerticalOffset={windowTop.y} …>
 */
import { useState } from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';

export interface WindowTop {
  /** 창 맨 위에서의 거리 (측정 전 0) */
  y: number;
  /** 측정할 View 의 onLayout 에 연결 (비활성이면 undefined) */
  onLayout: ((event: LayoutChangeEvent) => void) | undefined;
}

/** enabled 기본값: 네이티브에서만 (웹은 키보드 회피를 쓰지 않는다) */
export function useWindowTop(enabled: boolean = Platform.OS !== 'web'): WindowTop {
  const [y, setY] = useState(0);

  // 헤더 아래 띠가 나타나거나 단계 표시 높이가 바뀌면 이 View 의 크기·위치가 바뀌어 onLayout 이 다시 온다
  const onLayout = (event: LayoutChangeEvent) => {
    const view = event.currentTarget;
    if (!view || typeof view === 'number') return;
    view.measureInWindow((_x, top) => {
      if (Number.isFinite(top)) setY((prev) => (prev === top ? prev : top));
    });
  };

  return { y, onLayout: enabled ? onLayout : undefined };
}
