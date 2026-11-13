// Azure AI Speech 발음 평가: 녹음한 WAV를 보내 받아쓰기와 발음·유창성·억양 점수를 받는다 (레벨테스트).
// Microsoft Speech SDK(js/vendor/speech-sdk.min.js, 565KB)는 처음 쓸 때만 불러온다. 키와 지역은 설정에 저장된 것을 쓴다.
// 무료(F0) 등급은 한 달 5시간이고 한 번에 하나씩만 보낼 수 있으므로, 부르는 쪽(레벨테스트)이 차례로 보낸다.

import { azureErrorMessage, mergeAzureParts, parseAzureResult } from '../lib/level.js';

/** 고를 수 있는 지역 (리소스를 만든 지역과 같아야 한다) */
export const REGIONS = [
  ['koreacentral', '한국 중부'],
  ['japaneast', '일본 동부'],
  ['eastasia', '동아시아 (홍콩)'],
  ['southeastasia', '동남아시아 (싱가포르)'],
  ['australiaeast', '호주 동부'],
  ['eastus', '미국 동부'],
  ['eastus2', '미국 동부 2'],
  ['westus', '미국 서부'],
  ['westus2', '미국 서부 2'],
  ['centralus', '미국 중부'],
  ['westeurope', '서유럽'],
  ['northeurope', '북유럽'],
  ['uksouth', '영국 남부'],
];

let sdkLoading = null;

/** SDK를 불러온다 (한 번만). 테스트에서는 window.SpeechSDK를 미리 넣어 둔다 */
export function loadSpeechSdk() {
  if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
  sdkLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/speech-sdk.min.js', import.meta.url).href;
    s.async = true;
    s.onload = () =>
      window.SpeechSDK ? resolve(window.SpeechSDK) : reject(new Error('음성 평가 모듈을 불러오지 못했습니다.'));
    s.onerror = () => {
      sdkLoading = null;
      reject(new Error('음성 평가 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
    };
    document.head.append(s);
  });
  return sdkLoading;
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

/**
 * 녹음을 Azure로 보내 발음 평가를 받는다 (끝까지 이어서 인식: 1분짜리 자유 답변도 된다).
 * @param {{key: string, region: string, audio: Blob, referenceText?: string, signal?: AbortSignal,
 *   onPartial?: (r: object) => void}} o referenceText: 읽은 글(문장 읽기)이면 완성도(빠뜨린 단어)도 평가, 자유 답변은 빈 값
 * @returns {Promise<{transcript: string, scores: {pronunciation: number, fluency: number, prosody: number,
 *   completeness: number|null}, words: {word: string, accuracy: number|null, error: string}[], utterances: number}>}
 */
export async function assessSpeech({ key, region, audio, referenceText = '', signal, onPartial }) {
  if (!key || !region) throw new Error('Azure 음성 키와 지역을 설정에서 입력하세요.');
  if (signal?.aborted) throw abortError();
  const SDK = await loadSpeechSdk();
  const speechConfig = SDK.SpeechConfig.fromSubscription(key, region);
  speechConfig.speechRecognitionLanguage = 'en-US';
  const file = new File([audio], 'answer.wav', { type: audio.type || 'audio/wav' });
  const audioConfig = SDK.AudioConfig.fromWavFileInput(file);
  // fromJSON은 억양 평가 옵션을 버리므로 생성자로 만든다. 읽은 글이 있으면 빠뜨리거나 더한 단어(miscue)도 본다
  const pa = new SDK.PronunciationAssessmentConfig(
    referenceText || '',
    SDK.PronunciationAssessmentGradingSystem.HundredMark,
    SDK.PronunciationAssessmentGranularity.Word,
    Boolean(referenceText)
  );
  pa.enableProsodyAssessment = true;
  const rec = new SDK.SpeechRecognizer(speechConfig, audioConfig);
  pa.applyTo(rec);
  const parts = [];

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      const close = () => rec.close();
      rec.stopContinuousRecognitionAsync(close, close);
      fn();
    };
    const onAbort = () => finish(() => reject(abortError()));
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) return onAbort(); // SDK를 불러오는 사이에 취소됐다
    rec.recognized = (_s, e) => {
      if (e.result.reason !== SDK.ResultReason.RecognizedSpeech) return;
      const json = e.result.properties.getProperty(SDK.PropertyId.SpeechServiceResponse_JsonResult);
      const part = parseAzureResult(json, e.result.text);
      if (!part) return;
      parts.push(part);
      onPartial?.(mergeAzureParts(parts));
    };
    rec.canceled = (_s, e) => {
      if (e.reason === SDK.CancellationReason.Error) {
        finish(() =>
          reject(
            new Error(azureErrorMessage({ code: e.errorCode, details: e.errorDetails }, SDK.CancellationErrorCode))
          )
        );
      } else rec.stopContinuousRecognitionAsync(); // 파일 끝: sessionStopped가 온다
    };
    rec.sessionStopped = () => finish(() => resolve(mergeAzureParts(parts)));
    rec.startContinuousRecognitionAsync(undefined, (err) =>
      finish(() => reject(new Error(azureErrorMessage({ details: String(err) }, SDK.CancellationErrorCode))))
    );
  });
}

/** 1초짜리 무음 16kHz WAV (연결 테스트용: 사용량을 거의 쓰지 않는다) */
export function silentWav(seconds = 1) {
  const rate = 16000;
  const n = Math.round(rate * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * 키·지역이 맞는지 본다: 1초 무음을 보내 오류 없이 돌아오면 된다 (말소리가 없어 점수는 없다)
 * @returns {Promise<void>} 틀리면 이유를 담은 오류
 */
export async function testAzure({ key, region, signal } = {}) {
  await assessSpeech({ key, region, audio: silentWav(1), signal });
}
