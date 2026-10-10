/**
 * CKP 디자인 토큰 (DESIGN.md §6.2).
 * 색·간격·모서리·글자 크기·컨트롤 높이·그림자를 여기서만 정의하고, 화면에서는 이 값만 사용한다.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  primary: '#245DDB',
  primaryStrong: '#1948B0',
  primarySoft: '#EDF3FF',
  teal: '#19C2B4',
  tealSoft: '#E8F7F3',

  /** 본문 글자(네이비) */
  text: '#172B49',
  navy: '#172B49',
  textSecondary: '#53647B',
  textMuted: '#65758B',
  /** 어두운 배경 위 글자 */
  textInverse: '#FFFFFF',
  textInverseMuted: 'rgba(255,255,255,0.72)',

  border: '#DFE5EE',
  divider: '#EEF2F6',
  bg: '#F4F6FA',
  card: '#FFFFFF',
  /** 입력란 비활성 배경 */
  disabledBg: '#EEF1F5',

  accent: '#FDA100',
  accentSoft: '#FFF4DB',
  accentText: '#8A5300',

  success: '#0E8A5F',
  successSoft: '#E4F5EE',
  danger: '#C8323B',
  dangerSoft: '#FCEBEC',
  warning: '#8A5300',
  warningSoft: '#FFF4DB',

  sidebar: '#15243D',
  sidebarActive: '#284365',
  sidebarBorder: 'rgba(255,255,255,0.08)',

  /** 모달 뒤 어두운 막 */
  overlay: 'rgba(15,35,66,0.48)',
  /** 사진 확대 보기 배경 */
  viewerBg: '#05101F',
  white: '#FFFFFF',
  transparent: 'transparent',
} as const;

export type ColorToken = keyof typeof colors;

/** 4의 배수 간격 */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 6,
  control: 12,
  card: 16,
  pill: 999,
} as const;

/** 글자 크기 (본문 16, 보조 14, 캡션 12, 제목 20~24) */
export const fontSize = {
  caption: 13,
  secondary: 14,
  /** 작은 글자 버튼(로그인·회원가입 화면) — Text variant 'button' */
  button: 15,
  body: 16,
  heading: 18,
  title: 20,
  titleLg: 26,
} as const;

export const lineHeight = {
  caption: 19,
  secondary: 22,
  button: 20,
  body: 24,
  heading: 26,
  title: 28,
  titleLg: 36,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>;

/** 웹에서만 적용하는 한글 친화 글꼴 목록 (네이티브는 시스템 글꼴) */
export const webFontFamily =
  'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "맑은 고딕", "Noto Sans KR", "Segoe UI", Roboto, sans-serif';

export const fontFamily: TextStyle['fontFamily'] = Platform.OS === 'web' ? webFontFamily : undefined;

export const controlHeight = {
  /** 입력창 */
  input: 48,
  /** 기본 버튼 */
  button: 48,
  /** 큰 버튼(하단 고정 주요 동작) */
  buttonLg: 52,
  /** 작은 버튼(보조 동작) — hitSlop 으로 44 확보 */
  buttonSm: 40,
  /** 최소 터치 영역 */
  touch: 44,
} as const;

export const layout = {
  /** 모바일 상단 헤더 높이(안전영역 제외) */
  headerHeight: 56,
  /** 모바일 하단 탭 높이(안전영역 제외) */
  tabBarHeight: 72,
  /** 넓은 화면 좌측 사이드바 너비 */
  sidebarWidth: 232,
  /** 넓은 화면 본문 최대 너비 */
  contentMaxWidth: 1200,
  /** 폼 화면 본문 최대 너비 */
  formMaxWidth: 720,
  /** 화면 좌우 여백 (모바일 / 넓은 화면) */
  gutter: 16,
  gutterWide: 32,
  /** 넓은 화면 기준(웹, px) */
  wideMinWidth: 1024,
} as const;

/** 최소한의 그림자(카드 1dp 수준). New Architecture 는 boxShadow 를 모든 플랫폼에서 지원한다. */
export const shadow = {
  none: {} as ViewStyle,
  card: { boxShadow: '0px 2px 6px rgba(15, 35, 66, 0.025)' } as ViewStyle,
  raised: { boxShadow: '0px 8px 24px rgba(15, 35, 66, 0.09)' } as ViewStyle,
  overlay: { boxShadow: '0px 12px 32px rgba(15, 35, 66, 0.22)' } as ViewStyle,
} as const;

/** 입력란 포커스 링 */
export const focusRing: ViewStyle = { boxShadow: `0px 0px 0px 3px ${colors.primarySoft}` };

export const theme = {
  colors,
  spacing,
  radius,
  fontSize,
  lineHeight,
  fontWeight,
  fontFamily,
  controlHeight,
  layout,
  shadow,
  focusRing,
} as const;

export type Theme = typeof theme;
