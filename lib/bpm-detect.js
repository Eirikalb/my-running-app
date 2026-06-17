// Client-side BPM detection from a short audio clip. The DSP lives in
// lib/bpm-core.mjs so the Node crawler (lib/bpm-node.mjs) shares it exactly.

import { bpmFromAudioBuffer } from "./bpm-core.mjs";

let _ctx = null;
function audioCtx() {
  if (!_ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    _ctx = new AC();
  }
  return _ctx;
}

// Fetch a preview clip and return its BPM (or null if undetectable).
export async function detectBpmFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`preview fetch ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return detectBpmFromBuffer(arrayBuffer);
}

export async function detectBpmFromBuffer(arrayBuffer) {
  const audioBuffer = await audioCtx().decodeAudioData(arrayBuffer.slice(0));
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return bpmFromAudioBuffer(audioBuffer, Offline);
}
