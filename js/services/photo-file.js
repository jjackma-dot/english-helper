// 사진 번역에 보낼 사진 준비(돌려 찍은 방향 바로잡기·줄이기·긴 캡처 조각내기·JPEG), 다른 앱에서 공유받은 사진 꺼내기

import { photoPlan, rawFallback, JPEG_QUALITY } from '../lib/photo.js';

// 공유받은 사진을 sw.js가 잠시 넣어 두는 곳 (sw.js와 같아야 한다)
export const SHARE_INBOX = 'share-inbox';
const SHARED_KEY = 'shared-photo';

/**
 * 사진을 <img>로 불러 크기만 읽는다. 그림을 다 풀지 않으므로 5000만~2억 화소 사진도 메모리를 거의 쓰지 않는다.
 * 크롬의 <img>는 돌려 찍은 방향(EXIF)을 반영한 가로·세로를 알려 준다.
 * @returns {Promise<{img: HTMLImageElement, url: string}>} 다 쓰면 url을 지워야 한다
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이 사진은 열 수 없습니다.'));
    };
    img.src = url;
  });
}

/**
 * 사진을 처음부터 width×height로 줄여서 연다 (원본 크기로 다 풀면 큰 사진에서 메모리가 모자라 화면이 꺼질 수 있다).
 * 못 열면 불러 둔 <img>를 그대로 돌려준다 (그릴 때 줄인다. <img>도 돌려 찍은 방향을 반영해 그린다).
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
async function decodeAt(file, img, width, height) {
  if (typeof createImageBitmap !== 'function') return img;
  const open = (w, h) =>
    createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  try {
    let bmp = await open(width, height);
    // 크롬 버전에 따라 줄인 다음에 방향을 돌려 가로·세로가 뒤바뀌어 나오면(그림이 찌그러진다) 반대로 다시 연다
    if (width !== height && bmp.width === height && bmp.height === width) {
      bmp.close?.();
      bmp = await open(height, width);
    }
    return bmp;
  } catch {
    return img;
  }
}

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

/** 사진을 열어 보낼 크기로 줄이고, 아주 긴 세로 캡처는 조각내 JPEG로 만든다 */
async function shrink(file) {
  const { img, url } = await loadImage(file);
  try {
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('size');
    const { width, height, slices, small } = photoPlan(img.naturalWidth, img.naturalHeight);
    const source = await decodeAt(file, img, width, height);
    try {
      // 그릴 그림의 크기 (못 줄여서 <img>를 그대로 쓰면 원본 크기)
      const sw = source.naturalWidth || source.width;
      const sh = source.naturalHeight || source.height;
      const canvas = makeCanvas(width, slices[0].height); // 조각은 높이가 모두 같아 캔버스 하나로 그린다
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      const pieces = [];
      for (const s of slices) {
        ctx.fillStyle = '#fff'; // 투명한 PNG가 JPEG에서 검게 바뀌어 검은 글자가 안 보이지 않게
        ctx.fillRect(0, 0, width, s.height);
        if (slices.length === 1) ctx.drawImage(source, 0, 0, width, height);
        else {
          const k = sh / height; // 그림 크기 ÷ 보낼 크기
          ctx.drawImage(source, 0, s.y * k, sw, s.height * k, 0, 0, width, s.height);
        }
        pieces.push(await toJpeg(canvas));
      }
      return { blob: pieces[0], pieces, mimeType: 'image/jpeg', width, height, small };
    } finally {
      if (source !== img) source.close?.();
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 카메라·갤러리·공유로 받은 사진을 보낼 수 있게 준비한다.
 * 열지 못하면(크롬이 못 여는 HEIF 사진, 메모리가 모자란 아주 큰 사진) Gemini가 읽는 형식일 때 원본 그대로 보낸다.
 * @param {Blob & {name?: string}} file
 * @returns {Promise<{blob: Blob, pieces: Blob[], mimeType: string, width: number, height: number, small: boolean}>}
 *   pieces: 보낼 사진 (긴 캡처는 위에서부터 조각들), blob: 미리 보기 (첫 조각),
 *   small: 아주 긴 캡처를 조각 수에 맞추느라 많이 줄였다 (글자가 작을 수 있다). 원본을 그대로 보내면 width·height는 0
 */
export async function prepareImage(file) {
  if (!file?.size) throw new Error('사진 파일이 비어 있습니다. 다시 골라 주세요.');
  try {
    return await shrink(file);
  } catch {
    const raw = rawFallback(file);
    if (raw.ok) return { blob: file, pieces: [file], mimeType: raw.mimeType, width: 0, height: 0, small: false };
    throw new Error(
      raw.reason === 'size'
        ? '사진이 너무 커서 열 수 없습니다. 더 작은 사진을 골라 주세요.'
        : '이 사진은 열 수 없습니다. JPG나 PNG 사진으로 골라 주세요.'
    );
  }
}

/** 다른 앱에서 "공유 → English Helper"로 보낸 사진을 꺼낸다. 꺼내면 지운다 (두 번 꺼내지 않게). 없으면 null */
export async function takeSharedPhoto() {
  if (typeof caches === 'undefined') return null;
  const inbox = await caches.open(SHARE_INBOX);
  const key = new URL(SHARED_KEY, location.href).href;
  const res = await inbox.match(key);
  if (!res) return null;
  try {
    const blob = await res.blob();
    let name = '';
    try {
      name = decodeURIComponent(res.headers.get('X-File-Name') || '');
    } catch {
      /* 이름은 없어도 된다 */
    }
    return new File([blob], name || 'shared-photo', { type: blob.type });
  } finally {
    await inbox.delete(key);
  }
}

/** 꺼내지 않고 남은 공유 사진을 지운다 (모든 데이터 지우기) */
export async function clearSharedPhotos() {
  if (typeof caches === 'undefined') return;
  try {
    await caches.delete(SHARE_INBOX);
  } catch {
    /* 무시 */
  }
}
