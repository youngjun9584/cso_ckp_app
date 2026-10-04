/**
 * 사진 가져오기 — 웹. 숨긴 <input type="file"> 를 클릭 이벤트 안에서 바로 연다(브라우저의 사용자 동작 제한).
 * expo-image-picker 웹 구현은 모든 파일을 한꺼번에 <img> 로 디코딩해 크기를 재므로(휴대폰 브라우저에서 메모리 부담)
 * 여기서는 File 만 받아 두고 처리 큐에서 한 장씩(동시 2장) 디코딩한다.
 * selectionLimit 을 웹 브라우저가 지원하지 않으므로 초과분은 화면의 초과 안내 시트에서 처리한다.
 */
import type { PickOutcome, PickedFile } from './types';

/** HEIC 는 일부 브라우저의 image/* 필터에서 빠지므로 확장자를 함께 적는다 */
const ACCEPT_LIBRARY = 'image/*,.heic,.heif';
const ACCEPT_CAMERA = 'image/*';

let activeInput: HTMLInputElement | null = null;

export function fileToPicked(file: File): PickedFile {
  return {
    name: file.name || 'photo.jpg',
    uri: '',
    mimeType: file.type || null,
    size: file.size,
    width: 0,
    height: 0,
    blob: file,
  };
}

function openFileInput(options: { multiple: boolean; capture: boolean; accept: string }): Promise<PickOutcome> {
  if (typeof document === 'undefined') return Promise.resolve({ kind: 'canceled' });
  // 이전 입력이 취소 이벤트 없이 남아 있으면 치운다
  activeInput?.remove();

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = options.accept;
  input.multiple = options.multiple;
  if (options.capture) input.setAttribute('capture', 'environment');
  input.style.position = 'fixed';
  input.style.left = '-10000px';
  input.style.opacity = '0';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  document.body.appendChild(input);
  activeInput = input;

  return new Promise<PickOutcome>((resolve) => {
    let done = false;
    const finish = (outcome: PickOutcome) => {
      if (done) return;
      done = true;
      input.remove();
      if (activeInput === input) activeInput = null;
      resolve(outcome);
    };
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      finish(files.length ? { kind: 'picked', files: files.map(fileToPicked) } : { kind: 'canceled' });
    });
    // 취소 이벤트(대부분의 최신 브라우저). 지원하지 않으면 다음 선택 때 입력을 치운다.
    input.addEventListener('cancel', () => finish({ kind: 'canceled' }));
    try {
      input.click();
    } catch {
      finish({ kind: 'error', message: '파일 선택 창을 열지 못했습니다. 다시 시도해 주세요.' });
    }
  });
}

/** 파일(앨범)에서 여러 장 선택 — 남은 수는 웹에서 강제할 수 없어 무시한다 */
export function pickFromLibrary(_remaining: number): Promise<PickOutcome> {
  return openFileInput({ multiple: true, capture: false, accept: ACCEPT_LIBRARY });
}

/** 휴대폰 브라우저는 카메라, 데스크톱은 파일 선택 창 */
export function captureWithCamera(): Promise<PickOutcome> {
  return openFileInput({ multiple: false, capture: true, accept: ACCEPT_CAMERA });
}

export function openAppSettings(): void {
  // 웹은 권한 설정 화면이 없다 (브라우저 주소창의 사이트 설정 사용)
}

export const supportsFileDrop = true;
