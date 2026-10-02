import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Validate the native H.264/Opus container in the real browser too, rather
// than treating the presence of codec strings as successful playback.
const file = path.resolve(process.argv[2] || 'output/playwright/native-replay-h264-opus.mp4');
const bytes = await readFile(file);
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<video id="clip" width="320" playsinline></video>');
  const result = await page.evaluate(async data => {
    const raw = Uint8Array.from(atob(data), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([raw], { type: 'video/mp4' }));
    const video = document.querySelector('video');
    const audio = new AudioContext(), analyser = audio.createAnalyser(), gain = audio.createGain();
    gain.gain.value = 0;
    audio.createMediaElementSource(video).connect(analyser); analyser.connect(gain); gain.connect(audio.destination);
    let timer;
    try {
      await audio.resume();
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve; video.onerror = () => reject(new Error('MP4 decode failed'));
        timer = setTimeout(() => reject(new Error('MP4 decode timeout')), 10000);
        video.src = url;
      });
      clearTimeout(timer);
      video.currentTime = Math.min(2, video.duration / 2);
      await video.play();
      const before = video.getVideoPlaybackQuality().totalVideoFrames;
      let rms = 0;
      for (let sample = 0; sample < 20; sample++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const values = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(values);
        rms = Math.max(rms, Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length));
      }
      return { width: video.videoWidth, height: video.videoHeight, duration: video.duration,
        decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames - before, audioRms: rms, position: video.currentTime };
    } finally { clearTimeout(timer); video.pause(); video.src = ''; URL.revokeObjectURL(url); await audio.close(); }
  }, bytes.toString('base64'));
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.ok(result.decodedFrames > 5, 'Native MP4 must present moving video after seeking');
  assert.ok(result.audioRms > 0.001, 'Native Opus must actually decode to non-silent audio');
  const evidence = path.resolve('output/playwright', `replay-file-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(evidence, JSON.stringify({ file, bytes: bytes.length, status: 'passed', ...result }, null, 2));
  console.log(JSON.stringify({ status: 'passed', ...result, evidence }, null, 2));
} finally { await browser.close(); }
