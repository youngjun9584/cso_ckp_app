# CKP 앱 기반 코드 안내 (기능 개발자용)

설계 기준: `docs/DESIGN.md` · API 타입: `src/lib/api/contract.ts` (서버와 같은 파일, 임의 수정 금지).
모든 사용자 문구는 한국어. 모듈 최상위·렌더 중에 `window`/`localStorage`/SecureStore 를 건드리지 않는다.

## 폴더

```
src/app/                  라우트 (_layout.tsx, login.tsx, (app)/…)
  (app)/_layout.tsx       탭 셸 (모바일 하단 5탭 / 넓은 웹 좌측 사이드바, 첫 탭 = 홈) — 수정 불필요
  (app)/<탭>/_layout.tsx  탭별 Stack (headerShown:false, initialRouteName:'index')
  (app)/<탭>/*.tsx        기능 화면 (탭: home · medicines · notices · edi · clients)
  (app)/home/index.tsx    홈(메인 메뉴) — 로그인 후·'/' 의 첫 화면 (src/features/home/HomeScreen.tsx)
src/components/ui/        공통 UI (import { … } from '@/components/ui')
src/components/shell/     탭 바·부트 화면·PlaceholderScreen·stackScreenOptions·탭 목록(tabs.ts)·탭 이동 도우미(tab-navigation.ts)
src/lib/api/              getApi(), CkpApi, ApiError, http/upload/sample 구현
src/lib/auth/             AuthProvider, useAuth, useMeta 등
src/lib/navigation-guard.ts  화면 이탈 가드
src/lib/format.ts, kst.ts  표시·입력 도우미, KST 날짜
src/theme/                디자인 토큰, useIsWide
```

## 화면 기본 틀

```tsx
import { AppHeader, Screen } from '@/components/ui';

export default function MedicinesScreen() {
  return (
    <Screen header={<AppHeader title="의약품" />} scroll>
      {/* 내용 */}
    </Screen>
  );
}
// 상세: <AppHeader title="의약품 상세" back backHref="/medicines" />
// 목록(FlatList)은 <Screen header={…} padded={false}> 안에 FlatList 를 두고
//   const { contentStyle, gutter, wide } = useContentLayout();  으로 여백·최대 너비를 맞춘다.
// 입력 폼은 <Screen header={…} padded={false}><FormScroll footer={<Button … size="lg" fullWidth />}>…</FormScroll></Screen>
```

- AppHeader 는 모바일에서 CKP 심볼·계정 버튼·샘플/개발 서버 띠를 자동으로 그린다. 넓은 화면에서는 사이드바가 로고·모드 표시를 맡는다.
- 탭 루트 화면은 `back` 없이, 하위 화면은 `back backHref="/<탭>"` (웹 주소 직접 진입 시 돌아갈 곳).

## 공통 UI (`@/components/ui`)

| 컴포넌트 | 주요 props |
|---|---|
| `Screen` | `header?, scroll?, padded=true, maxWidth=1200\|null, safeTop?, safeBottom=false, keyboardAvoiding?, refreshControl?, contentContainerStyle?, scrollRef?` |
| `useContentLayout(maxWidth?)` | → `{ wide, gutter, contentStyle }` (FlatList contentContainerStyle 에 사용) |
| `AppHeader` | `title, subtitle?, back?: boolean\|()=>void, backHref?, right?, showAccount?, showLogo?, showModeBanner=true, maxWidth?` · `goBack(backHref)` |
| `Text` | `variant: titleLg\|title\|heading\|body\|bodyStrong\|secondary\|label\|caption`, `tone: default\|secondary\|muted\|primary\|danger\|success\|warning\|accent\|inverse\|inverseMuted`, `color?, weight?, align?` + RN Text props |
| `Button` | `title, onPress, variant: primary\|secondary\|soft\|ghost\|danger, size: sm(40)\|md(48)\|lg(52), icon?, iconRight?, loading?, disabled?, fullWidth?, style?` |
| `IconButton` | `icon, accessibilityLabel(필수), onPress, variant: plain\|filled\|outline\|onDark, size=44, iconSize=22, color?, disabled?, badge?` |
| `Icon` / `IconName` | Ionicons (`name, size=20, color`) — 장식용(스크린리더 숨김) |
| `TextField` | `label?, required?, helper?, error?, showCounter?(maxLength 필요), secureToggle?, leftIcon?, right?, containerStyle?, inputStyle?, ref?` + TextInput props |
| `SearchBar` | `value, onChangeText, onSubmit?(text), onDebouncedChange?(text), debounceMs=350, onClear?, loading?, placeholder?` |
| `Card` / `SectionTitle` | Card: `padded=true, onPress?(누르면 hover 포함), style?` · SectionTitle: `title, description?, right?` |
| `Badge` | `label, tone: neutral\|primary\|teal\|success\|warning\|danger\|accent, icon?, size: sm\|md, solid?` |
| `SegmentedControl<T>` | `options: {value,label,disabled?}[], value, onChange, accessibilityLabel?, fullWidth=true` |
| `ListRow` | `title, subtitle?, description?, icon?, left?, right?, chevron?, onPress?, divider?, tone: default\|danger` |
| `InfoRow` | `label, value?, children?, showEmpty=false, labelWidth=112, divider=true` — **값이 없으면 행을 숨긴다** |
| `EmptyState` | `title, description?, icon?, actionLabel?, onAction?, actionIcon?, compact?` |
| `NoResults` | `query?` → `'xxx'에 대한 검색 결과가 없습니다.`, `title?, description?, onClear?, compact?` |
| `ErrorState` | `error?`(ApiError 면 서버 메시지), `title?, message?, onRetry?, retrying?, compact?` |
| `LoadingState` | `label='불러오는 중입니다…', variant: spinner\|skeleton, rows?` · `Skeleton{width,height,radius}` · `SkeletonRows{count, variant: card\|row}` |
| `ModeBanner` | `variant: bar\|sidebar\|inline` (보통 직접 쓸 필요 없음), `MODE_BANNER_TEXT` |
| `FormScroll` | `footer?`(하단 고정, 키보드 위로 올라옴), `maxWidth=720, footerSafeArea?, keyboardVerticalOffset?, scrollRef?` — footer 안은 세로 배치, 가로 버튼은 row View 로 감싼다. 키보드 offset 은 FormScroll 이 창 기준 위치(헤더·모드 띠·단계 표시 아래)를 직접 재서 쓰므로 보통 넘기지 않는다(넘기면 측정값 대신 사용) |
| `ImageViewerModal` | `images: {uri,label?}[], index, visible, onClose, onIndexChange?` — 스와이프·화살표·웹 ←/→/Esc, 두 번 탭/클릭·핀치 확대, '3 / 12' 표시 |
| `LogoFull` / `LogoSymbol` / `BrandMark` | 전체 로고는 **네이비 배경에만** |

### 확인 대화상자·토스트 (컴포넌트 밖에서도 사용 가능)

```ts
import { confirm, alertDialog, toast } from '@/components/ui';
const ok = await confirm({ title: '삭제할까요?', message: '되돌릴 수 없습니다.', confirmText: '삭제', tone: 'danger' });
await alertDialog({ title: '등록되었습니다' });            // 버튼 하나
toast.success('등록되었습니다.'); toast.error('저장하지 못했습니다.'); toast.info('…'); toast.warning('…');
```
`confirm` 옵션: `title, message?, confirmText='확인', cancelText='취소'|null, tone: default|danger, dismissible=true`.
- iOS 는 다른 Modal 이 열려 있거나 닫히는 중이면 새 Modal 을 띄우지 못한다. ConfirmProvider 는 대화상자가 1.2초 안에 보이지 않으면(onShow 없음) 한 번 다시 띄우고,
  그래도 안 되면 시스템 대화상자(Alert)로 같은 질문을 해서 `confirm()` 이 끝나지 않는 일이 없게 한다. 그래도 **자기 Modal 을 닫고 곧바로 confirm/이동**해야 한다면
  iOS 에서는 Modal 의 `onDismiss`(iOS 전용) 에서 이어서 실행하는 편이 깔끔하다 (예: `ClientPicker` 의 '거래처 등록').

## 데이터 (`@/lib/api`)

```ts
import { getApi, ApiError, getErrorMessage, type MedicineSummary } from '@/lib/api';
const api = getApi();   // EXPO_PUBLIC_API_MODE/URL 에 따라 실서버(http) 또는 샘플(sample) 구현

useInfiniteQuery({
  queryKey: ['medicines', { q, field }],
  initialPageParam: 1,
  queryFn: ({ pageParam, signal }) => api.listMedicines({ q, field, page: pageParam, pageSize: 30 }, { signal }),
  getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
});
```

`CkpApi` 메서드 (모두 contract.ts 타입 반환, 두 번째 인자 `{ signal }` 선택):
`getMeta` · `login({usrId,password})` · `refresh()` · `restoreSession()` · `logout()` · `me` ·
`listMedicines({q,field,page,pageSize})` · `getMedicine(code)` · `listNotices({q,page,pageSize})` · `getNotice(idx)` ·
`listClients({q,page,pageSize})` · `getClient(idx)` · `checkClientDuplicate({name?,bizNo?,excludeIdx?})` · `createClient(body)` ·
`getEdiStatus` · `getEdiMonthOptions` · `uploadEdiPhoto(file, clientPhotoId, onProgress?, signal?)` ·
`createEdiSubmission(body, idempotencyKey)` · `listEdiSubmissions({ym,page,pageSize})` · `getEdiSubmission(id)` ·
`resolveUrl(url)` (서버가 '/v1/files/…' 상대 경로를 주면 절대 URL 로) · `mode: 'live'|'sample'`.

- **업로드**: `file: UploadFile = { uri, name, type:'image/jpeg', blob?, width?, height?, bytes? }` — native 는 `file://` uri, web 은 `blob`(또는 blob:/data: uri). 진행률 `onProgress({loaded,total,fraction})`, 타임아웃 90초, `signal` 로 취소. 401 이면 refresh 후 1회 재시도.
- **제출**: `createEdiSubmission(body, draft.idempotencyKey)` — 같은 키 재요청은 `replayed: true`.
- **오류**: 항상 `ApiError` — `code`(ApiErrorCode + `NETWORK_ERROR|TIMEOUT|ABORTED|INVALID_RESPONSE`), `message`(그대로 표시 가능한 한국어), `fields`(입력란별 메시지), `details`, `status`(응답 없으면 0), `isNetwork`(연결 실패·타임아웃), `isTimeout`, `isAborted`, `isRetryable`(네트워크·5xx), `isClientError`(4xx). `getErrorMessage(e)`.
- React Query 기본값: staleTime 30초, 재시도 1회(4xx·취소 제외) — `src/lib/query.ts`.
- 세션 만료(refresh 실패)는 자동으로 로그인 화면 + 안내 토스트.
- 제한값 기본: `DEFAULT_EDI_LIMITS` (meta 수신 전), `DEFAULT_FEATURES`.

### 샘플 모드 (`EXPO_PUBLIC_API_BASE_URL` 비움 또는 `EXPO_PUBLIC_API_MODE=sample`)
- 계정: `ckp_demo / demo1234` (승인 대기 `ckp_pending`, 접속 차단 `ckp_blocked`, 비밀번호 동일). `SAMPLE_DEMO_ACCOUNT`.
- 데이터: 의약품 92, 공지 24(HTML), 거래처 14(승인 대기 2, 미지정 1), EDI 내역(앱·이전 방식, 검토 상태·삭제된 사진 포함).
- 계정 화면 토글(`sampleSettings` / `useSampleSettings()` from `@/lib/api/sample`):
  `simulateUploadFailure` — 새 사진 3장 중 1장이 **연속 3회** 실패(자동 재시도 2회 포함) 후 다음 시도에서 성공 → "실패한 사진만 다시 시도" 흐름 확인용.
  `simulateEdiDisabled` — `getEdiStatus().enabled=false`, 업로드·제출 403 `EDI_DISABLED`.
- 샘플에서 등록한 EDI 는 앱을 다시 시작하면 사라진다(메모리). 웹은 업로드 시 별도 blob URL 을 만들어 두므로 작성 화면이 blob 을 해제해도 내역 사진이 보인다.

## 로그인·서버 정보 (`@/lib/auth`)

```ts
const { status, user, signIn, signOut, restoreError, retryRestore, reloadUser } = useAuth();
// status: 'restoring' | 'signedOut' | 'signedIn'   user: AuthUser | null
const meta = useMeta();          // useQuery(['meta']) — MetaResponse
const limits = useLimits();      // EdiLimits (기본값 포함)
const features = useFeatures();  // clientApprovalRequiredForEdi, clientTypeField, medicineFeeVisible
const { kind, label } = useDataSource(); // sample | development | production | unknown
```
토큰: access 는 메모리, refresh 는 native SecureStore / web httpOnly 쿠키(`credentials:'include'`). 화면 코드는 토큰을 직접 다루지 않는다.

## 화면 이탈 가드 (`@/lib/navigation-guard`)

```ts
useLeaveGuard('edi-draft', () => (hasDraft ? '작성 중인 EDI 등록 내용이 있습니다. 나가도 내용은 유지됩니다.' : null));
useBeforeUnloadWeb(uploading ? '업로드가 진행 중입니다.' : null);   // 웹 새로고침·닫기
await confirmLeave();              // 가드가 있으면 확인 대화상자 → true/false
await navigateGuarded('/edi');     // confirmLeave 후 이동
registerLeaveGuard(id, fn) → unregister;  getLeaveMessage();
```
`confirmLeave({ ignore: ['edi-new-draft'] })` — 이동하는 곳이 그 가드의 화면 자체일 때 해당 가드는 묻지 않는다. 확인 대화상자가 떠 있는 동안 들어온 다른 `confirmLeave()` 는 대화상자를 더 쌓지 않고 `false`.
탭 밖에서 탭을 열 때(홈 바로가기 등): `openTabRoot(tabs, tab)`(탭 첫 화면으로, 쌓인 상세는 되돌림) · `openTabScreen(tabs, 'edi', 'new', '/edi/new')`(이미 있으면 그 화면으로 돌아감) from `@/components/shell/tab-navigation` — `tabs = useNavigation().getParent()`.
탭 바·사이드바·헤더 계정 버튼·홈 바로가기는 이미 `confirmLeave()` 를 호출한다. 같은 스택 안 뒤로가기는 화면에서
`import { usePreventRemove } from 'expo-router/react-navigation'` 로 처리한다 (`@react-navigation/*` 직접 import 금지).

## 디자인 토큰 (`@/theme`)

`colors`(primary #0873B9, primaryStrong, primarySoft, teal, tealSoft, text/navy #0F2342, textSecondary, textMuted, border, divider, bg #F3F5F8, card,
accent #FDA100/accentSoft/accentText, success/successSoft, danger/dangerSoft, warning/warningSoft, sidebar, sidebarActive, overlay, viewerBg…),
`spacing`(xxs 2, xs 4, sm 8, md 12, lg 16, xl 20, xxl 24, xxxl 32), `radius`(sm 6, control 10, card 14, pill 999),
`fontSize`(caption 12, secondary 14, body 16, heading 18, title 20, titleLg 24), `lineHeight`, `fontWeight`,
`controlHeight`(input 48, button 48, buttonLg 52, buttonSm 40, touch 44), `layout`(headerHeight 56, tabBarHeight 60, sidebarWidth 240,
contentMaxWidth 1200, formMaxWidth 720, gutter 16/24, wideMinWidth 1024), `shadow`(card, raised, overlay), `focusRing`.
`useIsWide()` — 웹 && 창 너비 ≥ 1024 (하이드레이션 안전, 창 크기 변경 구독). 네이티브는 항상 false.

## 도우미

- `@/lib/format`: `formatBizNo`, `isValidBizNo`(국세청 검증번호), `formatPhone`, `onlyDigits`, `formatNumber`, `formatPrice(price, priceText)`, `formatBytes`, `emptyToNull`, `hasValue`.
- `@/lib/kst`: `kstDate()`, `kstDateTime()`, `kstYm()`, `addMonths(ym, n)`, `parseYm`, `formatYm('2026-08')→'2026년 8월'`, `formatYmd`, `formatDateTimeShort`.
- `@/lib/config`: `config.apiMode`, `config.apiBaseUrl`, `config.platform`, `isSampleMode`.
- `@/components/shell/stack-options`: 탭 Stack 공통 `stackScreenOptions`. `APP_TABS`(탭 순서·아이콘) in `@/components/shell/tabs`.
