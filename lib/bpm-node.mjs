// Server-side BPM detection for the offline crawler. Reuses the exact DSP from
// lib/bpm-core.mjs, but decodes audio with node-web-audio-api (Rust/Symphonia,
// no ffmpeg needed) instead of the browser's Web Audio. iTunes previews are
// AAC-in-m4a; node-web-audio-api decodes them fine.

import { OfflineAudioContext } from "node-web-audio-api";
import { bpmFromAudioBuffer } from "./bpm-core.mjs";

export async function detectBpmFromArrayBuffer(arrayBuffer) {
  // A throwaway offline context just to decode (no audio device opened).
  const decoder = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await decoder.decodeAudioData(arrayBuffer);
  return bpmFromAudioBuffer(audioBuffer, OfflineAudioContext);
}

export async function detectBpmFromUrl(url, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`preview fetch ${res.status}`);
  const ab = await res.arrayBuffer();
  return detectBpmFromArrayBuffer(ab);
}
