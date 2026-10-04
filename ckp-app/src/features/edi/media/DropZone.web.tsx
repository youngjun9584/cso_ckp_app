/**
 * 웹 드래그 앤 드롭 영역 (DESIGN §7.3): 점선 박스 '여기로 사진을 끌어다 놓으세요', dragover 강조.
 * DOM 이벤트가 필요해 react-native-web View 대신 div 를 쓴다(웹 전용 파일).
 * 이미지가 아닌 파일도 그대로 넘기고, 형식 판별·안내는 받는 쪽(사진 추가 흐름)이 한다.
 */
import { useRef, useState, type DragEvent } from 'react';

import { Icon, Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { fileToPicked } from './pick.web';
import type { DropZoneProps } from './types';

function hasFiles(event: DragEvent<HTMLDivElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function DropZone({ onFiles, disabled = false }: DropZoneProps) {
  const [over, setOver] = useState(false);
  // dragenter/dragleave 가 자식 요소마다 발생하므로 깊이를 센다
  const depth = useRef(0);

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current += 1;
    if (!disabled) setOver(true);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) onFiles(files.map(fileToPicked));
  };

  const active = over && !disabled;
  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      aria-disabled={disabled}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        minHeight: 104,
        padding: spacing.lg,
        borderRadius: radius.card,
        border: `2px dashed ${active ? colors.primary : colors.border}`,
        backgroundColor: active ? colors.primarySoft : colors.card,
        opacity: disabled ? 0.55 : 1,
        transition: 'background-color 120ms ease, border-color 120ms ease',
        boxSizing: 'border-box',
      }}
    >
      <Icon name="cloud-upload-outline" size={28} color={active ? colors.primary : colors.textMuted} />
      <Text variant="bodyStrong" tone={active ? 'primary' : 'default'} align="center">
        {active ? '놓으면 사진을 추가합니다' : '여기로 사진을 끌어다 놓으세요'}
      </Text>
      <Text variant="caption" tone="secondary" align="center">
        JPG · PNG · WEBP · HEIC, 한 번에 여러 장 가능
      </Text>
    </div>
  );
}
