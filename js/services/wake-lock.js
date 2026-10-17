// 화면 꺼짐 방지 (Screen Wake Lock). OTT 자막 따라가기·"방금 뭐라고?" 듣기·음성 튜터가 함께 쓰므로,
// 쓰는 쪽(owner)마다 따로 켜고 끄며 아무도 쓰지 않을 때만 놓는다.

const owners = new Set();
const idleWaiters = new Set();
let lock = null;
let requesting = false;

async function acquire() {
  if (lock || requesting || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  requesting = true;
  try {
    const l = await navigator.wakeLock.request('screen');
    // 예전 잠금의 release 이벤트가 늦게 와도 새 잠금을 잊지 않게, 자기 잠금일 때만 지운다
    l.addEventListener('release', () => {
      if (lock === l) lock = null;
    });
    lock = l;
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

/** @param {string} owner 예: 'subtitle', 'listen', 'tutor' */
export function keepAwake(owner, on) {
  if (on) {
    owners.add(owner);
    acquire();
  } else if (owners.delete(owner) && !owners.size) {
    release();
    const waiters = [...idleWaiters];
    idleWaiters.clear();
    for (const cb of waiters) cb();
  }
}

/** 화면을 켜 두는 일(음성 대화·OTT 듣기·자막 따라가기)이 없으면 바로, 있으면 모두 끝난 뒤에 cb를 한 번 부른다 */
export function whenIdle(cb) {
  if (owners.size) idleWaiters.add(cb);
  else cb();
}

// 화면을 벗어나면 브라우저가 잠금을 풀어 버리므로, 돌아왔을 때 아직 쓰는 쪽이 있으면 다시 건다
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && owners.size) acquire();
});
