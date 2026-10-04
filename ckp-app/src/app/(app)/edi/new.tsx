import { useLocalSearchParams } from 'expo-router';

import { EdiNewScreen } from '@/features/edi/new';

/**
 * 새 EDI 등록 (3단계, DESIGN §7).
 * 거래처 상세의 "이 거래처로 EDI 등록" → /edi/new?clientIdx=5003&clientName=… 로 거래처를 미리 선택한다.
 */
export default function EdiNewRoute() {
  const params = useLocalSearchParams<{ clientIdx?: string; clientName?: string }>();
  const idx = Number(params.clientIdx);
  const name = typeof params.clientName === 'string' ? params.clientName.trim() : '';
  const initialClient = Number.isInteger(idx) && idx > 0 && name ? { idx, name, selectable: null } : null;
  return <EdiNewScreen initialClient={initialClient} />;
}
