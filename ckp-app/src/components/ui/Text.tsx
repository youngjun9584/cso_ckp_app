import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { colors, fontFamily, fontSize, fontWeight, lineHeight } from '@/theme';

export type TextVariant =
  | 'titleLg' // 24 굵게
  | 'title' // 20 굵게
  | 'heading' // 18 굵게
  | 'body' // 16
  | 'bodyStrong' // 16 굵게
  | 'secondary' // 14
  | 'label' // 14 중간 굵기 (입력 라벨)
  | 'button' // 15 중간 굵기 (작은 글자 버튼 — Button labelVariant="button")
  | 'caption'; // 12

export type TextTone =
  | 'default'
  | 'secondary'
  | 'muted'
  | 'primary'
  | 'danger'
  | 'success'
  | 'warning'
  | 'accent'
  | 'inverse'
  | 'inverseMuted';

const VARIANTS: Record<TextVariant, TextStyle> = {
  titleLg: { fontSize: fontSize.titleLg, lineHeight: lineHeight.titleLg, fontWeight: fontWeight.bold },
  title: { fontSize: fontSize.title, lineHeight: lineHeight.title, fontWeight: fontWeight.bold },
  heading: { fontSize: fontSize.heading, lineHeight: lineHeight.heading, fontWeight: fontWeight.bold },
  body: { fontSize: fontSize.body, lineHeight: lineHeight.body, fontWeight: fontWeight.regular },
  bodyStrong: { fontSize: fontSize.body, lineHeight: lineHeight.body, fontWeight: fontWeight.semibold },
  secondary: { fontSize: fontSize.secondary, lineHeight: lineHeight.secondary, fontWeight: fontWeight.regular },
  label: { fontSize: fontSize.secondary, lineHeight: lineHeight.secondary, fontWeight: fontWeight.semibold },
  button: { fontSize: fontSize.button, lineHeight: lineHeight.button, fontWeight: fontWeight.semibold },
  caption: { fontSize: fontSize.caption, lineHeight: lineHeight.caption, fontWeight: fontWeight.regular },
};

export const TONE_COLORS: Record<TextTone, string> = {
  default: colors.text,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  primary: colors.primary,
  danger: colors.danger,
  success: colors.success,
  warning: colors.warning,
  accent: colors.accentText,
  inverse: colors.textInverse,
  inverseMuted: colors.textInverseMuted,
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** 직접 색 지정 (tone 보다 우선) */
  color?: string;
  weight?: keyof typeof fontWeight;
  align?: TextStyle['textAlign'];
}

/** 앱 공통 글자. 기본은 본문 16 / 네이비 */
export function Text({ variant = 'body', tone = 'default', color, weight, align, style, ...rest }: TextProps) {
  return (
    <RNText
      {...rest}
      style={[
        { fontFamily, color: color ?? TONE_COLORS[tone] },
        VARIANTS[variant],
        weight ? { fontWeight: fontWeight[weight] } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
