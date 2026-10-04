/**
 * 웹 전용 HEIC → JPEG 변환. heic2any(약 1.3MB)는 필요할 때만 불러온다(동적 import → 별도 번들).
 * 브라우저가 HEIC 를 직접 읽을 수 있으면(Safari 17+) process.web.ts 가 이 함수를 부르지 않는다.
 */

type Heic2Any = (options: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>;

let loader: Promise<Heic2Any | null> | null = null;

function loadHeic2Any(): Promise<Heic2Any | null> {
  if (!loader) {
    loader = import('heic2any')
      .then((mod) => {
        // UMD(CommonJS) 모듈이라 번들러에 따라 default 로 감싸지거나 그대로 온다
        const candidate = (mod as { default?: unknown }).default ?? mod;
        return typeof candidate === 'function' ? (candidate as Heic2Any) : null;
      })
      .catch(() => {
        loader = null; // 다음에 다시 시도할 수 있게
        return null;
      });
  }
  return loader;
}

/** 변환 성공 시 JPEG Blob, 실패 시 null */
export async function convertHeicToJpeg(blob: Blob): Promise<Blob | null> {
  const heic2any = await loadHeic2Any();
  if (!heic2any) return null;
  try {
    const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 });
    const first = Array.isArray(out) ? out[0] : out;
    return first instanceof Blob && first.size > 0 ? first : null;
  } catch {
    return null;
  }
}
