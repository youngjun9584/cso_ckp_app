/**
 * 공지 본문 링크 열기 — https / mailto / tel 만 허용한다 (서버 정화 규칙 §5.6 과 같은 목록).
 * - native: https 는 앱 안 브라우저(WebBrowser), mailto·tel 은 기기 앱(Linking)
 * - web: https 는 새 탭(noopener), mailto·tel 은 현재 창에서 처리
 */
import { Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { toast } from '@/components/ui';
import { colors } from '@/theme';

export type SafeLinkKind = 'https' | 'mailto' | 'tel';

export function getSafeLinkKind(href: string | null | undefined): SafeLinkKind | null {
  const m = /^\s*([a-z][a-z0-9+.-]*):/i.exec(href ?? '');
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  return scheme === 'https' || scheme === 'mailto' || scheme === 'tel' ? scheme : null;
}

const FAIL_MESSAGE: Record<SafeLinkKind, string> = {
  https: '링크를 열 수 없습니다. 잠시 후 다시 시도해 주세요.',
  mailto: '메일 앱을 열 수 없습니다. 기기에 메일 앱이 설정되어 있는지 확인해 주세요.',
  tel: '전화를 걸 수 없습니다. 이 기기에서 전화 기능을 사용할 수 있는지 확인해 주세요.',
};

/** 이미 검증한 웹 주소를 연다 (native: 앱 안 브라우저 / web: 새 탭) */
async function openWebUrl(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await WebBrowser.openBrowserAsync(url, {
    controlsColor: colors.primary,
    toolbarColor: colors.card,
    dismissButtonStyle: 'close',
  });
}

export async function openSafeLink(href: string): Promise<void> {
  const kind = getSafeLinkKind(href);
  if (!kind) {
    toast.warning('이 링크는 열 수 없습니다. https·메일·전화 링크만 열 수 있습니다.');
    return;
  }
  const url = href.trim();
  try {
    if (kind === 'https') {
      await openWebUrl(url);
      return;
    }
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.location.href = url;
      return;
    }
    await Linking.openURL(url);
  } catch {
    toast.error(FAIL_MESSAGE[kind]);
  }
}

/**
 * 첨부파일 열기: https 이거나 연결된 API 서버 주소(개발 서버는 http 일 수 있음)로 시작할 때만 연다.
 */
export async function openAttachmentUrl(url: string | null, apiBaseUrl: string | null): Promise<void> {
  const target = url?.trim() ?? '';
  const allowed = getSafeLinkKind(target) === 'https' || (!!apiBaseUrl && target.startsWith(`${apiBaseUrl}/`));
  if (!allowed) {
    toast.warning('이 첨부파일은 열 수 없습니다.');
    return;
  }
  try {
    await openWebUrl(target);
  } catch {
    toast.error('첨부파일을 열 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
}
