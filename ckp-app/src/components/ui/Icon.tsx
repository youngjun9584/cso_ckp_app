import type { ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors } from '@/theme';

/** Ionicons 이름 (예: 'search', 'chevron-forward', 'images-outline') */
export type IconName = ComponentProps<typeof Ionicons>['name'];

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

/** 장식용 아이콘 (스크린리더에서 숨김). 의미가 있으면 감싸는 요소에 접근성 라벨을 준다. */
export function Icon({ name, size = 20, color = colors.textSecondary }: IconProps) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    />
  );
}
