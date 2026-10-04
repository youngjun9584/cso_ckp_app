import { Badge } from '@/components/ui';
import type { ClientApproval } from '@/lib/api';
import { approvalBadgeInfo } from './approval';

export interface ClientApprovalBadgeProps {
  approval: ClientApproval;
  size?: 'sm' | 'md';
}

/** 승인 → 초록 '승인', 승인 대기 → 노랑 '승인 대기', 미지정 → 표시 안 함 */
export function ClientApprovalBadge({ approval, size = 'sm' }: ClientApprovalBadgeProps) {
  const info = approvalBadgeInfo(approval);
  if (!info) return null;
  return <Badge label={info.label} tone={info.tone} icon={info.icon} size={size} accessibilityLabel={`승인 상태: ${info.label}`} />;
}
