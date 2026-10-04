import { useLocalSearchParams } from 'expo-router';

import { NoticeDetailScreen } from '@/features/notices/NoticeDetailScreen';

/** 공지사항 상세 (idx 가 숫자가 아니면 '찾을 수 없음') */
export default function NoticeDetailRoute() {
  const params = useLocalSearchParams<{ idx: string | string[] }>();
  const raw = Array.isArray(params.idx) ? params.idx[0] : params.idx;
  const value = /^\d+$/.test(raw ?? '') ? Number(raw) : NaN;
  const idx = Number.isSafeInteger(value) && value > 0 ? value : null;
  return <NoticeDetailScreen idx={idx} />;
}
