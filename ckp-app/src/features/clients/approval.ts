/** 거래처 승인 상태 표시 규칙 (DESIGN §6.5: 승인 success / 승인 대기 accent / 미지정은 배지 없음) */
import type { BadgeTone, IconName } from '@/components/ui';
import type { ClientApproval, ClientSummary } from '@/lib/api';

export interface ApprovalBadgeInfo {
  label: string;
  tone: BadgeTone;
  icon: IconName;
}

export function approvalBadgeInfo(approval: ClientApproval): ApprovalBadgeInfo | null {
  if (approval === 'approved') return { label: '승인', tone: 'success', icon: 'checkmark-circle' };
  if (approval === 'pending') return { label: '승인 대기', tone: 'accent', icon: 'time-outline' };
  return null;
}

export const APPROVAL_PENDING_EDI_MESSAGE = '관리자 승인 후 EDI 등록에 사용할 수 있습니다.';

/** EDI 등록에 선택할 수 없는 이유 (선택 가능하면 null) */
export function unselectableReason(
  client: Pick<ClientSummary, 'approval' | 'selectableForEdi'>,
  override?: string,
): string | null {
  if (client.selectableForEdi) return null;
  if (override) return override;
  if (client.approval === 'pending') return APPROVAL_PENDING_EDI_MESSAGE;
  return '현재 EDI 등록에 사용할 수 없는 거래처입니다.';
}
