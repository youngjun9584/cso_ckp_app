/**
 * 사진 가져오기 — iOS/Android (웹은 pick.web.ts).
 * 옵션은 DESIGN §7.2 그대로 (node_modules/expo-image-picker/build/ImagePicker.types.d.ts 확인):
 *   mediaTypes ['images'], allowsMultipleSelection, selectionLimit(남은 수), orderedSelection, quality 1, exif false,
 *   preferredAssetRepresentationMode Compatible (iOS 가 HEIC 대신 JPEG 를 준다).
 */
import { Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import type { PickOutcome, PickedFile } from './types';

function toPicked(asset: ImagePicker.ImagePickerAsset, index: number): PickedFile {
  return {
    name: asset.fileName?.trim() || `photo-${index + 1}.jpg`,
    uri: asset.uri,
    mimeType: asset.mimeType ?? null,
    size: typeof asset.fileSize === 'number' ? asset.fileSize : null,
    width: asset.width || 0,
    height: asset.height || 0,
    assetType: asset.type ?? null,
  };
}

function isPermissionError(error: unknown): boolean {
  const text = `${(error as { code?: unknown })?.code ?? ''} ${(error as { message?: unknown })?.message ?? ''}`.toLowerCase();
  return text.includes('permission');
}

/** 앨범에서 여러 장 선택 (remaining = 더 추가할 수 있는 장수, 1 이상) */
export async function pickFromLibrary(remaining: number): Promise<PickOutcome> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, remaining),
      orderedSelection: true,
      quality: 1,
      exif: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets?.length) return { kind: 'canceled' };
    return { kind: 'picked', files: result.assets.map(toPicked) };
  } catch (error) {
    if (isPermissionError(error)) return { kind: 'denied', target: 'library' };
    return { kind: 'error', message: '사진 앨범을 열지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}

/** 카메라로 1장 촬영 (권한 요청 포함) */
export async function captureWithCamera(): Promise<PickOutcome> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { kind: 'denied', target: 'camera' };
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (result.canceled || !result.assets?.length) return { kind: 'canceled' };
    return { kind: 'picked', files: result.assets.map(toPicked) };
  } catch (error) {
    if (isPermissionError(error)) return { kind: 'denied', target: 'camera' };
    return { kind: 'error', message: '카메라를 열지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}

/** 권한 거절 시 '설정 열기' */
export function openAppSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

/** 웹 드래그 앤 드롭·파일 입력 지원 여부 (native 는 없음) */
export const supportsFileDrop = false;
