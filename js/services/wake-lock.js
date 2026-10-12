// 화면 꺼짐 방지 (Screen Wake Lock). OTT 자막 따라가기와 "방금 뭐라고?" 듣기가 함께 쓰므로,
// 쓰는 쪽(owner)마다 따로 켜고 끄며 아무도 쓰지 않을 때만 놓는다.

const owners = new Set();
let lock = null;
let requesting = false;

async function acquire() {
  if (lock || requesting || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  requesting = true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => (lock = null));
    if (!owners.size) release(); // 기다리는 사이에 모두 껐다
  } catch {
    lock = null; // 배터리 절약 모드 등에서는 거부될 수 있다
  } finally {
    requesting = false;
  }
}

function release() {
  lock?.release().catch(() => {});
  lock = null;
}

/** @param {string} owner 예: 'subtitle', 'listen' */
export function keepAwake(owner, on) {
  if (on) {
    owners.add(owner);
    acquire();
  } else if (owners.delete(owner) && !owners.size) {
    release();
  }
}

// 화면을 벗어나면 브라우저가 잠금을 풀어 버리므로, 돌아왔을 때 아직 쓰는 쪽이 있으면 다시 건다
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && owners.size) acquire();
});
