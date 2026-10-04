/** API 계층 → AuthProvider 로 "세션 만료"를, AuthProvider → 기능 모듈로 "로그인 종료"를 알리는 작은 이벤트 버스 */
type Listener = () => void;

/** logout: 사용자가 로그아웃 / expired: refresh 까지 실패해 세션이 끝남 */
export type SignedOutReason = 'logout' | 'expired';
type SignedOutListener = (reason: SignedOutReason) => void;

const listeners = new Set<Listener>();
const signedOutListeners = new Set<SignedOutListener>();

export const sessionEvents = {
  /** refresh 까지 실패해 다시 로그인해야 할 때 API 계층이 호출 */
  emitExpired(): void {
    for (const listener of [...listeners]) listener();
  },
  onExpired(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /**
   * 로그인 상태가 끝날 때 AuthProvider 가 호출한다(로그아웃은 서버에 알리기 전, 토큰을 지우기 전에).
   * 화면 밖에서 도는 작업(EDI 업로드·제출 등)이 다음에 로그인하는 사용자의 세션으로 이어지지 않게 멈추는 데 쓴다.
   */
  emitSignedOut(reason: SignedOutReason): void {
    for (const listener of [...signedOutListeners]) {
      try {
        listener(reason);
      } catch {
        // 한 기능의 정리 오류가 로그아웃을 막지 않게 한다
      }
    }
  },
  onSignedOut(listener: SignedOutListener): () => void {
    signedOutListeners.add(listener);
    return () => {
      signedOutListeners.delete(listener);
    };
  },
};
