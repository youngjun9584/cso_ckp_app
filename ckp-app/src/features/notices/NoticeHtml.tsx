/**
 * 공지 본문 HTML 렌더러 (@native-html/render).
 * - 서버가 정화한 HTML(§5.6)을 그대로 그린다. 이미지는 본문 폭에 맞추고, 누르면 확대 보기.
 * - 링크는 https / mailto / tel 만 연다 (links.ts).
 * - 표는 가로 스크롤 + 칸 최소 폭으로 좁은 화면에서도 읽을 수 있게 한다.
 */
import { createContext, use, useMemo, type PropsWithChildren } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet } from 'react-native';
import RenderHTML, {
  IMGElement,
  useContentWidth,
  useIMGElementProps,
  type CustomBlockRenderer,
  type CustomTagRendererRecord,
  type FallbackFontsDefinitions,
  type GenericPressableProps,
  type MixedStyleDeclaration,
  type MixedStyleRecord,
  type RenderersProps,
} from '@native-html/render';

import { asInteraction } from '@/components/ui/pressable-state';
import { colors, fontSize, spacing, webFontFamily } from '@/theme';
import { openSafeLink } from './links';

/** 이미지가 눌렸을 때 (원본 src) */
const ImagePressContext = createContext<((src: string) => void) | null>(null);

const NoticeImage: CustomBlockRenderer = function NoticeImage(props) {
  const imgProps = useIMGElementProps(props);
  const onImagePress = use(ImagePressContext);
  const src = typeof props.tnode.attributes.src === 'string' ? props.tnode.attributes.src : '';
  const alt = props.tnode.attributes.alt;
  const pressable = !!onImagePress && src.length > 0;
  return (
    <IMGElement
      {...imgProps}
      containerProps={{
        ...imgProps.containerProps,
        ...(pressable
          ? { accessibilityRole: 'imagebutton' as const, accessibilityLabel: alt ? `${alt}, 크게 보기` : '공지 이미지 크게 보기' }
          : null),
      }}
      onPress={pressable ? () => onImagePress(src) : undefined}
    />
  );
};

const NoticeTable: CustomBlockRenderer = function NoticeTable({ TDefaultRenderer, ...props }) {
  const contentWidth = useContentWidth();
  return (
    <ScrollView
      horizontal
      bounces={false}
      showsHorizontalScrollIndicator
      style={styles.tableScroll}
      contentContainerStyle={styles.tableScrollContent}
    >
      <TDefaultRenderer {...props} style={[props.style, { minWidth: contentWidth }]} />
    </ScrollView>
  );
};

const NoticeTableCell: CustomBlockRenderer = function NoticeTableCell({ TDefaultRenderer, ...props }) {
  return <TDefaultRenderer {...props} style={[props.style, styles.cell]} />;
};

const renderers: CustomTagRendererRecord = {
  img: NoticeImage,
  table: NoticeTable,
  th: NoticeTableCell,
  td: NoticeTableCell,
};

/** 링크·이미지 등 누를 수 있는 요소 (웹 hover·커서 포함) */
function HtmlPressable({ style, children, borderless, ...rest }: PropsWithChildren<GenericPressableProps>) {
  void borderless;
  return (
    <Pressable
      {...rest}
      style={(state) => {
        const { hovered, pressed } = asInteraction(state);
        return [style, hovered && styles.pressHover, pressed && styles.pressPressed];
      }}
    >
      {children}
    </Pressable>
  );
}

const renderersProps: Partial<RenderersProps> = {
  a: {
    onPress: (_event, href) => {
      void openSafeLink(href);
    },
  },
  img: {
    enableExperimentalPercentWidth: true,
  },
};

const isWeb = Platform.OS === 'web';

const fallbackFonts: FallbackFontsDefinitions = {
  'sans-serif': Platform.select({ web: webFontFamily, ios: 'System', default: 'sans-serif' }),
  serif: Platform.select({ web: webFontFamily, ios: 'Georgia', default: 'serif' }),
  monospace: Platform.select({
    web: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "D2Coding", monospace',
    ios: 'Menlo',
    default: 'monospace',
  }),
};

const baseStyle: MixedStyleDeclaration = {
  color: colors.text,
  fontSize: fontSize.body,
  lineHeight: 26,
  // 웹에서만 앱 글꼴 목록을 쓴다 (네이티브는 시스템 글꼴)
  ...(isWeb ? { fontFamily: 'sans-serif' } : null),
};

const cellBase: MixedStyleDeclaration = {
  paddingTop: spacing.sm,
  paddingBottom: spacing.sm,
  paddingLeft: spacing.md - 2,
  paddingRight: spacing.md - 2,
  borderRightWidth: 1,
  borderBottomWidth: 1,
  borderRightColor: colors.border,
  borderBottomColor: colors.border,
  fontSize: fontSize.secondary,
  lineHeight: 20,
};

const tagsStyles: MixedStyleRecord = {
  body: { color: colors.text },
  p: { marginTop: 0, marginBottom: spacing.md },
  h1: { fontSize: 24, lineHeight: 32, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.md },
  h2: { fontSize: 20, lineHeight: 28, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.md - 2 },
  h3: { fontSize: 18, lineHeight: 26, fontWeight: '700', marginTop: spacing.xs + 2, marginBottom: spacing.sm },
  h4: { fontSize: 16, lineHeight: 24, fontWeight: '700', marginTop: spacing.xs, marginBottom: spacing.sm },
  a: { color: colors.primary, textDecorationLine: 'underline' },
  strong: { fontWeight: '700' },
  b: { fontWeight: '700' },
  ul: { marginTop: 0, marginBottom: spacing.md, paddingLeft: spacing.xl + 2 },
  ol: { marginTop: 0, marginBottom: spacing.md, paddingLeft: spacing.xl + 2 },
  li: { marginBottom: spacing.xs },
  blockquote: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    marginLeft: 0,
    marginRight: 0,
    paddingTop: spacing.md - 2,
    paddingBottom: spacing.md - 2,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.md + 2,
    backgroundColor: colors.bg,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    color: colors.textSecondary,
  },
  hr: { backgroundColor: colors.border, height: 1, marginTop: spacing.lg, marginBottom: spacing.lg },
  table: {
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderTopColor: colors.border,
    borderLeftColor: colors.border,
  },
  th: { ...cellBase, backgroundColor: '#F7F9FC', fontWeight: '700', color: colors.text },
  td: { ...cellBase },
  code: { fontFamily: 'monospace', backgroundColor: colors.divider, fontSize: fontSize.secondary },
  pre: {
    fontFamily: 'monospace',
    backgroundColor: colors.divider,
    fontSize: 13,
    lineHeight: 20,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    marginTop: 0,
    marginBottom: spacing.md,
  },
  img: { marginTop: spacing.xs, marginBottom: spacing.sm },
};

const defaultTextProps = { selectable: true };

const ignoredDomTags = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'];

export interface NoticeHtmlProps {
  html: string;
  /** 본문이 그려질 실제 폭 (이미지·표 크기 계산) */
  contentWidth: number;
  onImagePress?: (src: string) => void;
}

export function NoticeHtml({ html, contentWidth, onImagePress }: NoticeHtmlProps) {
  const source = useMemo(() => ({ html }), [html]);
  return (
    <ImagePressContext value={onImagePress ?? null}>
      <RenderHTML
        source={source}
        contentWidth={Math.max(1, Math.floor(contentWidth))}
        renderers={renderers}
        renderersProps={renderersProps}
        GenericPressable={HtmlPressable}
        baseStyle={baseStyle}
        tagsStyles={tagsStyles}
        fallbackFonts={fallbackFonts}
        ignoredDomTags={ignoredDomTags}
        defaultTextProps={defaultTextProps}
        enableExperimentalBRCollapsing={!isWeb}
        enableExperimentalGhostLinesPrevention
        pressableHightlightColor={colors.primarySoft}
      />
    </ImagePressContext>
  );
}

const styles = StyleSheet.create({
  tableScroll: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    flexGrow: 0,
  },
  tableScrollContent: {
    flexGrow: 1,
  },
  cell: {
    minWidth: 96,
  },
  pressHover: {
    opacity: 0.9,
  },
  pressPressed: {
    opacity: 0.75,
  },
});

