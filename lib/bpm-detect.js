// Client-side BPM detection from a short audio clip.
//
// Approach (a well-worn one for web audio): isolate the low end (kick/bass)
// with a band filter, find rhythmic peaks above an adaptive threshold, then
// histogram the intervals between nearby peaks and take the most common tempo.
// Good enough to auto-fill a song's BPM from a 30s preview; users can override.

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

  // Render through a band filter focused on percussive low end.
  const offline = new OfflineAudioContext(1, audioBuffer.length, audioBuffer.sampleRate);
  const src = offline.createBufferSource();
  src.buffer = audioBuffer;

  const lowpass = offline.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 150;
  lowpass.Q.value = 1;

  const highpass = offline.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 90;
  highpass.Q.value = 1;

  src.connect(lowpass);
  lowpass.connect(highpass);
  highpass.connect(offline.destination);
  src.start(0);

  const rendered = await offline.startRendering();
  const data = rendered.getChannelData(0);
  const sampleRate = rendered.sampleRate;

  const peaks = findPeaks(data, sampleRate);
  if (peaks.length < 4) return null;
  return tempoFromPeaks(peaks, sampleRate);
}

// Collect peaks above an adaptive threshold, lowering it until we have enough.
function findPeaks(data, sampleRate) {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > max) max = a;
  }
  if (max === 0) return [];

  const minGap = Math.floor(sampleRate * 0.2); // >=200ms apart -> caps at 300 BPM
  let peaks = [];
  for (let frac = 0.9; frac >= 0.2; frac -= 0.05) {
    const threshold = max * frac;
    peaks = [];
    for (let i = 0; i < data.length; ) {
      if (Math.abs(data[i]) > threshold) {
        peaks.push(i);
        i += minGap;
      } else {
        i++;
      }
    }
    if (peaks.length > 30) break;
  }
  return peaks;
}

// Histogram intervals between nearby peaks; fold tempo into a runnable range.
function tempoFromPeaks(peaks, sampleRate) {
  const counts = {};
  for (let i = 0; i < peaks.length; i++) {
    for (let j = 1; j <= 10 && i + j < peaks.length; j++) {
      const intervalSec = (peaks[i + j] - peaks[i]) / sampleRate;
      if (intervalSec <= 0) continue;
      let bpm = 60 / intervalSec;
      while (bpm < 70) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      bpm = Math.round(bpm);
      counts[bpm] = (counts[bpm] || 0) + 1;
    }
  }
  let best = null;
  let bestCount = 0;
  for (const bpm in counts) {
    if (counts[bpm] > bestCount) {
      bestCount = counts[bpm];
      best = Number(bpm);
    }
  }
  return best;
}
