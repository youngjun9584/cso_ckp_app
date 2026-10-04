/** 웹: 처리본·썸네일 blob URL 해제 (사진 제거·초기화·완료 시, DESIGN §7.3) */
import type { ProcessedImage } from '../draft/types';
import type { ReleaseOptions } from './cleanup';

function revoke(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith('blob:') || typeof URL === 'undefined') return;
  try {
    URL.revokeObjectURL(uri);
  } catch {
    // 무시
  }
}

export function deleteQuietly(uri: string | null | undefined): void {
  revoke(uri);
}

/** 웹은 원본을 File(메모리)로만 들고 있어 지울 임시 파일이 없다 */
export function releaseSource(_uri: string | null | undefined): void {}

// 웹 샘플 API 는 업로드 시 별도 blob URL 을 만들어 두므로 keepFiles 와 상관없이 해제한다
export function releaseProcessed(processed: ProcessedImage | null | undefined, _options: ReleaseOptions = {}): void {
  if (!processed) return;
  revoke(processed.uri);
  if (processed.thumbUri !== processed.uri) revoke(processed.thumbUri);
}

/** 웹은 캐시 폴더가 없다 */
export function sweepStaleMediaCache(): void {}
