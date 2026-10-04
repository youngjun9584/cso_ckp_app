import { useLocalSearchParams } from 'expo-router';

import { MedicineDetailScreen } from '@/features/medicines/MedicineDetailScreen';

/** 의약품 상세 (보험코드) */
export default function MedicineDetailRoute() {
  const params = useLocalSearchParams<{ code: string | string[] }>();
  const raw = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = (raw ?? '').trim();
  return <MedicineDetailScreen code={code} />;
}
