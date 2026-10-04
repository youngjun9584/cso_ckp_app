/**
 * XHR multipart 업로드 (DESIGN §6.4/§7.3).
 * 전역 fetch(expo/fetch)는 RN 의 {uri,name,type} FormData 를 지원하지 않고 업로드 진행률도 없으므로 XHR 을 쓴다.
 * - native: FormData.append('file', { uri, name, type })  → RN 네트워킹이 파일을 스트리밍
 * - web   : 처리된 Blob (file.blob 또는 blob:/data: URL 을 읽어서)
 */
import { Platform } from 'react-native';

import type { UploadFile, UploadProgressHandler } from './client';
import { ApiError, parseJsonSafe, toApiError } from './errors';

export interface XhrUploadOptions {
  url: string;
  file: UploadFile;
  /** multipart 파일 필드 이름 */
  fileField?: string;
  /** 파일보다 먼저 보내는 텍스트 필드 (서버가 파일 수신 전에 읽는다) */
  fields?: Record<string, string>;
  headers?: Record<string, string>;
  onProgress?: UploadProgressHandler;
  signal?: AbortSignal;
  timeoutMs?: number;
  withCredentials?: boolean;
}

export interface XhrUploadResult {
  status: number;
  body: unknown;
}

async function readWebBlob(file: UploadFile): Promise<Blob> {
  if (file.blob) return file.blob;
  try {
    const res = await fetch(file.uri);
    return await res.blob();
  } catch {
    throw new ApiError({ code: 'IMAGE_DECODE_FAILED', message: '사진 파일을 읽을 수 없습니다. 사진을 다시 선택해 주세요.' });
  }
}

/** 2xx 가 아니면 ApiError 로 reject. 성공 시 {status, body} */
export async function xhrUpload(options: XhrUploadOptions): Promise<XhrUploadResult> {
  const { url, file, fileField = 'file', fields = {}, headers = {}, onProgress, signal, timeoutMs = 90_000 } = options;

  if (signal?.aborted) throw ApiError.aborted();

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);

  if (Platform.OS === 'web') {
    const blob = await readWebBlob(file);
    if (signal?.aborted) throw ApiError.aborted();
    form.append(fileField, blob, file.name);
  } else {
    // RN 전용 파일 파트. DOM 타입의 FormData.append 는 이 형태를 모르므로 캐스팅한다.
    form.append(fileField, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }

  return new Promise<XhrUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    function onAbort() {
      xhr.abort();
    }

    xhr.open('POST', url);
    xhr.timeout = timeoutMs;
    xhr.withCredentials = options.withCredentials ?? false;
    xhr.setRequestHeader('Accept', 'application/json');
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event: ProgressEvent) => {
        const total = event.lengthComputable && event.total > 0 ? event.total : (file.bytes ?? 0);
        const fraction = total > 0 ? Math.min(1, event.loaded / total) : 0;
        onProgress({ loaded: event.loaded, total, fraction });
      };
    }

    xhr.onload = () => {
      const body = parseJsonSafe(xhr.responseText ?? '');
      if (xhr.status >= 200 && xhr.status < 300) {
        if (body === undefined) {
          finish(() => reject(new ApiError({ code: 'INVALID_RESPONSE', message: '서버 응답을 해석할 수 없습니다. 잠시 후 다시 시도해 주세요.', status: xhr.status })));
          return;
        }
        onProgress?.({ loaded: file.bytes ?? 1, total: file.bytes ?? 1, fraction: 1 });
        finish(() => resolve({ status: xhr.status, body }));
      } else if (xhr.status === 0) {
        finish(() => reject(ApiError.network()));
      } else {
        finish(() => reject(toApiError(xhr.status, body)));
      }
    };
    xhr.onerror = () => finish(() => reject(ApiError.network()));
    xhr.ontimeout = () => finish(() => reject(ApiError.timeout()));
    xhr.onabort = () => finish(() => reject(ApiError.aborted()));

    signal?.addEventListener('abort', onAbort);
    xhr.send(form);
  });
}
