/**
 * uuid v4 생성. 웹은 https 가 아닌 주소(예: 같은 와이파이의 http://192.168.x.x)에서
 * crypto.randomUUID 가 없으므로 getRandomValues 로 대신 만든다.
 */
import * as Crypto from 'expo-crypto';

import { isUuidV4, uuidV4FromBytes } from './ids';

export function newUuid(): string {
  try {
    const id = Crypto.randomUUID();
    if (isUuidV4(id)) return id;
  } catch {
    // 아래 대체 방법 사용
  }
  return uuidV4FromBytes(Crypto.getRandomBytes(16));
}
