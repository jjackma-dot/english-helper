// 스캔 번역용 카메라: 뒤 카메라를 열어 <video>에 보여 주고, 화면에 보이는 장면을 보낼 JPEG로 찍는다.
// 찍은 장면은 저장하지 않는다.

import { JPEG_QUALITY, MAX_SIDE } from '../lib/photo.js';
import { isIOS } from '../ui.js';

export const cameraSupported = Boolean(navigator.mediaDevices?.getUserMedia);

function makeCanvas(width, height) {
  return typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
}

function toJpeg(canvas) {
  return canvas.convertToBlob
    ? canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
    : new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('jpeg'))), 'image/jpeg', JPEG_QUALITY)
      );
}

function cameraError(e) {
  if (e?.name === 'NotAllowedError')
    return new Error(
      isIOS
        ? '카메라 권한이 거부되었습니다. Safari의 ⋯(또는 aA) 메뉴 → 웹 사이트 설정 → 카메라, 또는 설정 → 앱 → Safari → 카메라에서 허용하세요.'
        : '카메라 권한이 거부되었습니다. 주소창 옆 설정(또는 앱 정보 → 권한)에서 카메라를 허용하세요.'
    );
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return new Error('카메라를 찾을 수 없습니다.');
  if (e?.name === 'NotReadableError') return new Error('다른 앱이 카메라를 쓰고 있어 열 수 없습니다.');
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * 뒤 카메라를 열어 video에 보여 준다.
 * 화면에는 카메라 그림을 칸에 꽉 채워(가장자리는 잘림) 보여 주므로, 찍는 것도 화면에 보이는 부분만 쓴다.
 * @param {HTMLVideoElement} video
 * @param {{onEnded?: () => void, aspect?: () => number}} [o] onEnded: 다른 앱·권한 회수 등으로 카메라가 끊김
 *   (stop()으로 닫을 때는 오지 않는다), aspect: 카메라를 보여 주는 칸의 가로÷세로 (모르면 0: 그림 전체)
 * @returns {Promise<{capture: () => Promise<Blob|null>, torch: boolean, setTorch: (on: boolean) => Promise<boolean>,
 *   stop: () => void}>} capture: 보낼 JPEG (아직 그림이 없으면 null), torch: 손전등을 켤 수 있음,
 *   setTorch: 켜거나 끈다 (됐는지 돌려줌)
 */
export async function openCamera(video, { onEnded, aspect = () => 0 } = {}) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    throw cameraError(e);
  }
  const track = stream.getVideoTracks()[0];
  let stopped = false;
  track?.addEventListener('ended', () => {
    if (!stopped) onEnded?.();
  });
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    /* 소리 없는 영상은 저절로 재생되지만, 막혀도 찍을 수는 있다 */
  }
  const caps = track?.getCapabilities?.() ?? {};

  /** 그림에서 화면에 보이는 부분 (object-fit: cover로 가운데를 칸 모양만큼) */
  function visible() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const r = aspect();
    if (!(r > 0)) return { x: 0, y: 0, w: vw, h: vh };
    if (vw / vh > r) {
      const w = Math.round(vh * r);
      return { x: Math.round((vw - w) / 2), y: 0, w, h: vh };
    }
    const h = Math.round(vw / r);
    return { x: 0, y: Math.round((vh - h) / 2), w: vw, h };
  }

  return {
    async capture() {
      if (stopped || !(video.videoWidth > 0 && video.videoHeight > 0)) return null;
      const v = visible();
      const k = Math.min(1, MAX_SIDE / Math.max(v.w, v.h));
      const w = Math.round(v.w * k);
      const h = Math.round(v.h * k);
      const canvas = makeCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, v.x, v.y, v.w, v.h, 0, 0, w, h);
      return toJpeg(canvas);
    },
    torch: Boolean(caps.torch),
    async setTorch(on) {
      try {
        await track.applyConstraints({ advanced: [{ torch: on }] });
        return true;
      } catch {
        return false;
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.pause?.();
      video.srcObject = null;
    },
  };
}
