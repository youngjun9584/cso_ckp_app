/** uuid v4 도우미 (순수 함수 — 난수 바이트는 호출하는 쪽이 넣는다) */

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(value: string | null | undefined): boolean {
  return !!value && UUID_V4_RE.test(value);
}

/** 16바이트 난수 → RFC 4122 v4 문자열 */
export function uuidV4FromBytes(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new Error('uuidV4FromBytes: 16 bytes required');
  const b = Array.from(bytes.slice(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
