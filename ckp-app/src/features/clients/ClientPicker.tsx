/**
 * 내 거래처 선택 (EDI 등록 1단계 등에서 사용).
 *   <ClientPicker value={draft.client} onChange={(c) => setClient({ idx: c.idx, name: c.name })} />
 * - 입력란 모양의 버튼을 누르면 검색 가능한 목록(모바일 전체 화면 / 넓은 웹 가운데 대화상자)이 열린다.
 * - EDI 에 쓸 수 없는 거래처(selectableForEdi=false)는 흐리게 표시하고 이유를 보여주며 선택할 수 없다.
 */
import { useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  NoResults,
  SearchBar,
  SkeletonRows,
  Text,
} from '@/components/ui';
import { asInteraction } from '@/components/ui/pressable-state';
import type { ClientSummary } from '@/lib/api';
import { useFeatures } from '@/lib/auth';
import { navigateGuarded } from '@/lib/navigation-guard';
import { colors, controlHeight, focusRing, radius, shadow, spacing, useIsWide } from '@/theme';
import { approvalBadgeInfo, unselectableReason } from './approval';
import { ClientApprovalBadge } from './ClientApprovalBadge';
import { flattenClients, useClientList } from './queries';

export interface ClientPickerValue {
  idx: number;
  name: string;
}

export interface ClientPickerProps {
  value: ClientPickerValue | null;
  onChange: (client: ClientSummary) => void;
  /** 선택할 수 없는 거래처 아래에 보여줄 이유 (기본: 승인 대기 → '관리자 승인 후 EDI 등록에 사용할 수 있습니다.') */
  disabledReasonText?: string;
  /** 입력란 위 라벨 (기본 '거래처'). 빈 문자열이면 라벨 없음 */
  label?: string;
  required?: boolean;
  error?: string | null;
  /** 편집 잠금(제출 중 등) */
  disabled?: boolean;
  placeholder?: string;
}

export function ClientPicker({
  value,
  onChange,
  disabledReasonText,
  label = '거래처',
  required,
  error,
  disabled = false,
  placeholder = '거래처를 선택하세요',
}: ClientPickerProps) {
  const [open, setOpen] = useState(false);
  // 열 때마다 검색어를 새로 시작하도록 목록 내용을 다시 만든다
  const [session, setSession] = useState(0);

  function show() {
    if (disabled) return;
    setSession((s) => s + 1);
    setOpen(true);
  }

  function select(client: ClientSummary) {
    setOpen(false);
    onChange(client);
  }

  return (
    <View style={styles.container}>
      {label ? (
        <View style={styles.labelRow}>
          <Text variant="label">{label}</Text>
          {required ? (
            <Text variant="label" tone="danger" accessibilityLabel="필수">
              *
            </Text>
          ) : null}
        </View>
      ) : null}

      <Pressable
        onPress={show}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label || '거래처'}: ${value.name}` : `${label || '거래처'} 선택${required ? ', 필수' : ''}`}
        accessibilityHint={value ? '눌러서 다른 거래처로 변경합니다' : '눌러서 내 거래처 목록을 엽니다'}
        accessibilityState={{ disabled }}
        style={(state) => {
          const { hovered, focused, pressed } = asInteraction(state);
          return [
            styles.trigger,
            { borderColor: error ? colors.danger : focused ? colors.primary : colors.border },
            disabled ? styles.triggerDisabled : hovered || pressed ? styles.triggerHover : null,
            focused && !error ? focusRing : null,
          ];
        }}
      >
        <Icon name="business-outline" size={20} color={value ? colors.primary : colors.textMuted} />
        <Text variant="body" tone={value ? 'default' : 'muted'} numberOfLines={1} style={styles.flex}>
          {value ? value.name : placeholder}
        </Text>
        {!disabled ? (
          <Text variant="label" tone="primary">
            {value ? '변경' : '선택'}
          </Text>
        ) : null}
        <Icon name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite" role="alert">
          <Icon name="alert-circle" size={16} color={colors.danger} />
          <Text variant="secondary" tone="danger" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : null}

      <ClientPickerModal
        key={session}
        visible={open}
        selectedIdx={value?.idx ?? null}
        disabledReasonText={disabledReasonText}
        onSelect={select}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

interface ClientPickerModalProps {
  visible: boolean;
  selectedIdx: number | null;
  disabledReasonText?: string;
  onSelect: (client: ClientSummary) => void;
  onClose: () => void;
}

function ClientPickerModal({ visible, selectedIdx, disabledReasonText, onSelect, onClose }: ClientPickerModalProps) {
  const wide = useIsWide();
  const insets = useSafeAreaInsets();
  const features = useFeatures();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const q = query.trim();

  const list = useClientList(q, { enabled: visible });
  const items = flattenClients(list.data?.pages);
  const total = list.data?.pages[0]?.total ?? 0;
  const searching = list.isFetching && list.isPlaceholderData;

  function clearSearch() {
    setInput('');
    setQuery('');
  }

  // iOS 는 이 Modal 이 닫히는 도중에 확인 대화상자(또 다른 Modal)를 띄우지 못한다 →
  // '거래처 등록'은 목록이 완전히 닫힌 뒤(onDismiss, iOS 전용) 이동한다. Android·웹은 바로 이동해도 된다.
  const pendingRegister = useRef(false);

  function goRegister() {
    onClose();
    if (Platform.OS === 'ios') {
      pendingRegister.current = true;
      return;
    }
    void navigateGuarded('/clients/new', 'push');
  }

  function handleDismiss() {
    if (!pendingRegister.current) return;
    pendingRegister.current = false;
    void navigateGuarded('/clients/new', 'push');
  }

  function loadMore() {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) void list.fetchNextPage();
  }

  let empty: ReactNode = null;
  if (list.isPending) empty = <SkeletonRows count={6} variant="row" />;
  else if (list.isError && !list.data) empty = <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isRefetching} compact />;
  else if (q) empty = <NoResults query={q} description="거래처명·대표자·주소·전화번호·사업자등록번호로 검색할 수 있습니다." onClear={clearSearch} compact />;
  else
    empty = (
      <EmptyState
        icon="business-outline"
        title="등록된 거래처가 없습니다"
        description="거래처를 먼저 등록한 뒤 선택해 주세요."
        actionLabel="거래처 등록"
        actionIcon="add"
        onAction={goRegister}
        compact
      />
    );

  const panel = (
    <View
      style={[
        styles.panel,
        wide ? styles.panelWide : [styles.panelFull, { paddingTop: insets.top, paddingBottom: insets.bottom }],
      ]}
      role="dialog"
      aria-modal
      accessibilityViewIsModal
      aria-label="거래처 선택"
    >
      <View style={styles.header}>
        <Text variant="heading" role="heading" style={styles.flex}>
          거래처 선택
        </Text>
        <IconButton icon="close" accessibilityLabel="닫기" onPress={onClose} />
      </View>

      <View style={styles.searchWrap}>
        <SearchBar
          value={input}
          onChangeText={setInput}
          onDebouncedChange={(text) => setQuery(text.trim())}
          onSubmit={(text) => setQuery(text)}
          onClear={clearSearch}
          loading={searching}
          placeholder="거래처명, 대표자, 전화번호 등"
          accessibilityLabel="거래처 검색"
          autoFocus={wide}
        />
        {list.data && items.length > 0 ? (
          <Text variant="caption" tone="secondary">
            {q ? `검색 결과 ${total}곳` : `내 거래처 ${total}곳`}
          </Text>
        ) : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.idx)}
        renderItem={({ item }) => (
          <PickerRow
            client={item}
            selected={item.idx === selectedIdx}
            reason={unselectableReason(item, disabledReasonText)}
            onPress={() => onSelect(item)}
          />
        )}
        ListEmptyComponent={<View style={styles.emptyWrap}>{empty}</View>}
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : list.isFetchNextPageError ? (
            <View style={styles.footerLoading}>
              <Button title="목록 더 불러오기" icon="refresh" variant="secondary" size="sm" onPress={() => void list.fetchNextPage()} />
            </View>
          ) : null
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        style={styles.flex}
        contentContainerStyle={styles.listContent}
      />

      {items.length > 0 ? (
        <View style={styles.bottomBar}>
          <Text variant="caption" tone="secondary" style={styles.flex}>
            {features.clientApprovalRequiredForEdi
              ? '새로 등록한 거래처는 관리자 승인 후 선택할 수 있습니다.'
              : '목록에 없는 거래처는 새로 등록할 수 있습니다.'}
          </Text>
          <Button title="거래처 등록" icon="add" variant="ghost" size="sm" onPress={goRegister} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType={wide ? 'fade' : 'slide'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onDismiss={handleDismiss}
    >
      {wide ? (
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="거래처 선택 닫기"
            importantForAccessibility="no"
            tabIndex={-1}
          />
          {panel}
        </View>
      ) : (
        <View style={styles.fullscreen}>{panel}</View>
      )}
    </Modal>
  );
}

interface PickerRowProps {
  client: ClientSummary;
  selected: boolean;
  /** 선택할 수 없는 이유 (null 이면 선택 가능) */
  reason: string | null;
  onPress: () => void;
}

function PickerRow({ client, selected, reason, onPress }: PickerRowProps) {
  const disabled = reason !== null;
  const sub = [client.representative ? `대표 ${client.representative}` : null, client.address].filter(
    (v): v is string => !!v?.trim(),
  );
  const approval = approvalBadgeInfo(client.approval);
  const a11y = [client.name, approval ? `승인 상태 ${approval.label}` : null, ...sub, reason ? `선택할 수 없음: ${reason}` : null]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={a11y}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      aria-disabled={disabled}
      style={(state) => {
        const { hovered, pressed } = asInteraction(state);
        return [styles.row, selected ? styles.rowSelected : !disabled && (hovered || pressed) ? styles.rowHover : null];
      }}
    >
      <View style={[styles.radio, selected && styles.radioOn, disabled && styles.faded]}>
        {selected ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
      </View>
      <View style={styles.rowTexts}>
        <View style={[styles.rowTop, disabled && styles.faded]}>
          <Text variant="bodyStrong" numberOfLines={1} style={styles.flexShrink}>
            {client.name}
          </Text>
          <ClientApprovalBadge approval={client.approval} />
        </View>
        {sub.length ? (
          <Text variant="secondary" tone="secondary" numberOfLines={1} style={disabled ? styles.faded : undefined}>
            {sub.join(' · ')}
          </Text>
        ) : null}
        {reason ? (
          <View style={styles.reasonRow}>
            <Icon name="lock-closed-outline" size={13} color={colors.accentText} />
            <Text variant="caption" tone="accent" style={styles.flexShrink}>
              {reason}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs + 2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: controlHeight.input,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.card,
  },
  triggerHover: {
    backgroundColor: '#F8FAFC',
  },
  triggerDisabled: {
    backgroundColor: colors.disabledBg,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  // RN-web 의 Modal 래퍼는 늘어나지 않으므로 절대 위치로 전체를 채운다
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  fullscreen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.card,
  },
  panel: {
    backgroundColor: colors.card,
  },
  panelFull: {
    flex: 1,
  },
  // flex 를 주지 않는다: RN-web 에서 flex:0 은 flex-basis 0% 가 되어 height 를 무시한다
  panelWide: {
    width: '100%',
    maxWidth: 560,
    height: '85%',
    maxHeight: 720,
    borderRadius: radius.card + 2,
    overflow: 'hidden',
    ...shadow.overlay,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: spacing.lg,
  },
  emptyWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  footerLoading: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 60,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowHover: {
    backgroundColor: '#F6F8FB',
  },
  rowSelected: {
    backgroundColor: colors.primarySoft,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  radioOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  rowTexts: {
    flex: 1,
    gap: 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  faded: {
    opacity: 0.5,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
});
