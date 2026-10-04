/**
 * 앱이 만든 임시 파일 정리 — iOS/Android (웹은 cleanup.web.ts: blob URL 해제).
 * 지우는 것은 앱 캐시 안의 두 폴더뿐이다(사용자 앨범의 사진은 절대 건드리지 않는다):
 *   …/ImageManipulator/…  expo-image-manipulator 가 만든 처리본·썸네일
 *   …/ImagePicker/…       expo-image-picker 가 앨범·카메라 사진을 앱 캐시에 복사해 둔 원본 (quality 1 이면 전체 크기)
 */
import { Directory, File, Paths } from 'expo-file-system';

import type { ProcessedImage } from '../draft/types';

const MANIPULATOR_DIR = 'ImageManipulator';
const PICKER_DIR = 'ImagePicker';

function isCacheFileIn(uri: string | null | undefined, dirs: readonly string[]): uri is string {
  return !!uri && uri.startsWith('file://') && dirs.some((dir) => uri.includes(`/${dir}/`));
}

function deleteFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // 이미 지워졌거나 접근할 수 없음 — 등록 흐름을 막지 않는다
  }
}

/** 처리본·썸네일(또는 원본을 그대로 쓰는 경우 선택기 복사본)을 지운다 */
export function deleteQuietly(uri: string | null | undefined): void {
  if (isCacheFileIn(uri, [MANIPULATOR_DIR, PICKER_DIR])) deleteFile(uri);
}

/** 선택기·카메라가 캐시에 만든 원본 복사본을 지운다 (처리가 끝났거나 draft 에 넣지 않은 파일) */
export function releaseSource(uri: string | null | undefined): void {
  if (isCacheFileIn(uri, [PICKER_DIR])) deleteFile(uri);
}

export interface ReleaseOptions {
  /**
   * 샘플 모드(native)는 업로드 응답의 사진 주소가 이 처리 파일을 그대로 가리킨다 → 업로드된 사진 파일은 남긴다.
   * (웹은 샘플 API 가 별도 blob URL 을 만들어 두므로 해당 없음)
   */
  keepFiles?: boolean;
}

export function releaseProcessed(processed: ProcessedImage | null | undefined, options: ReleaseOptions = {}): void {
  if (!processed || options.keepFiles) return;
  deleteQuietly(processed.uri);
  if (processed.thumbUri !== processed.uri) deleteQuietly(processed.thumbUri);
}

/**
 * 이전 실행이 남긴 임시 파일 폴더를 통째로 지운다(앱이 강제 종료되면 정리할 기회가 없었던 파일들).
 * draft 는 메모리에만 있으므로 이번 실행에서 사진을 추가하기 전에만 호출해야 한다. 두 라이브러리 모두 저장할 때 폴더를 다시 만든다.
 */
export function sweepStaleMediaCache(): void {
  for (const name of [MANIPULATOR_DIR, PICKER_DIR]) {
    try {
      const dir = new Directory(Paths.cache, name);
      if (dir.exists) dir.delete();
    } catch {
      // 정리하지 못해도 등록 흐름에는 영향 없음 (OS 가 캐시를 비울 수 있다)
    }
  }
}
