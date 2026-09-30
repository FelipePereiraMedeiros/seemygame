export function deltaMetrics(previous, current) {
  const dt = (current.timestamp - previous.timestamp) / 1000;
  const delta = key => Number.isFinite(current[key]) && Number.isFinite(previous[key]) && current[key] >= previous[key] ? current[key] - previous[key] : null;
  const ratio = (a, b, scale = 1000) => { const x = delta(a), y = delta(b); return x !== null && y > 0 ? scale * x / y : null; };

  const decodeTimeMs = ratio('totalDecodeTime', 'framesDecoded');
  const jitterBufferMs = ratio('jitterBufferDelay', 'jitterBufferEmittedCount');
  const bridgeObservableMs = (decodeTimeMs !== null || jitterBufferMs !== null)
    ? ((decodeTimeMs ?? 0) + (jitterBufferMs ?? 0))
    : null;
  const audioSamplesDelta = delta('totalSamplesReceived');
  const concealedSamplesDelta = delta('concealedSamples');
  const concealmentEventsDelta = delta('concealmentEvents');
  const audioPacketsLostDelta = delta('packetsLost');
  const audioPacketsDiscardedDelta = delta('packetsDiscarded');

  return {
    encodeTimeMs: ratio('totalEncodeTime', 'framesEncoded'),
    decodeTimeMs,
    jitterBufferMs,
    bridgeObservableMs,
    packetSendDelayMs: ratio('totalPacketSendDelay', 'packetsSent'),
    decodedFps: dt > 0 && delta('framesDecoded') !== null ? delta('framesDecoded') / dt : null,
    sentMbps: dt > 0 && delta('bytesSent') !== null ? delta('bytesSent') * 8 / dt / 1e6 : null,
    audioSamplesDelta,
    concealedSamplesDelta,
    concealmentEventsDelta,
    audioPacketsLostDelta,
    audioPacketsDiscardedDelta,
    audioConcealmentRatio: audioSamplesDelta !== null && audioSamplesDelta > 0 && concealedSamplesDelta !== null
      ? Number(((concealedSamplesDelta / audioSamplesDelta) * 100).toFixed(2))
      : null,
    audioBytesDelta: delta('bytesReceived'),
    rawDeltaTotalDecodeTime: delta('totalDecodeTime'),
    rawDeltaFramesDecoded: delta('framesDecoded'),
    rawDeltaTotalEncodeTime: delta('totalEncodeTime'),
    rawDeltaFramesEncoded: delta('framesEncoded'),
    rawDeltaJitterBufferDelay: delta('jitterBufferDelay'),
    rawDeltaJitterBufferEmittedCount: delta('jitterBufferEmittedCount'),
    rawDeltaFramesDropped: delta('framesDropped'),
    rawDeltaFramesReceived: delta('framesReceived'),
    rawDeltaFreezeCount: delta('freezeCount'),
    rawDeltaTotalFreezesDuration: delta('totalFreezesDuration'),
    rawDeltaNackCount: delta('nackCount'),
    rawDeltaPliCount: delta('pliCount'),
    rawDeltaPacketsLost: delta('packetsLost'),
    rawDeltaPacketsDiscarded: delta('packetsDiscarded'),
    rawDeltaPacketsReceived: delta('packetsReceived'),
    rawDeltaConcealedSamples: delta('concealedSamples'),
    rawDeltaSilentConcealedSamples: delta('silentConcealedSamples'),
    rawDeltaConcealmentEvents: delta('concealmentEvents'),
    rawDeltaInsertedSamplesForDeceleration: delta('insertedSamplesForDeceleration'),
    rawDeltaRemovedSamplesForAcceleration: delta('removedSamplesForAcceleration')
  };
}

export function computeSteadyQuality({
  baselineVideoRow = {},
  latestVideoRow = {},
  baselineAudioRow = null,
  latestAudioRow = null,
  elapsedSteadySec = 0
} = {}) {
  const safeDelta = (curr, base) => {
    if (curr == null) return null;
    const b = base ?? 0;
    return curr >= b ? curr - b : 0;
  };

  const steadyFreezes = safeDelta(latestVideoRow?.freezeCount, baselineVideoRow?.freezeCount) ?? 0;
  const steadyFreezeDurationSec = latestVideoRow?.totalFreezesDuration != null
    ? Math.max(0, Number(((latestVideoRow.totalFreezesDuration) - (baselineVideoRow?.totalFreezesDuration ?? 0)).toFixed(3)))
    : 0;

  const steadyFramesDropped = safeDelta(latestVideoRow?.framesDropped, baselineVideoRow?.framesDropped) ?? 0;
  const steadyFramesReceived = safeDelta(latestVideoRow?.framesReceived, baselineVideoRow?.framesReceived) ?? 0;
  const steadyFramesDecoded = safeDelta(latestVideoRow?.framesDecoded, baselineVideoRow?.framesDecoded) ?? 0;
  const steadyPacketsLost = safeDelta(latestVideoRow?.packetsLost, baselineVideoRow?.packetsLost) ?? 0;
  const steadyPacketsReceived = safeDelta(latestVideoRow?.packetsReceived, baselineVideoRow?.packetsReceived) ?? 0;

  let audioMetrics = {
    audioSamplesReceived: 0,
    audioConcealedSamples: 0,
    audioSilentConcealedSamples: 0,
    audioConcealmentEvents: 0,
    audioPacketsLost: 0,
    audioPacketsDiscarded: 0,
    audioPacketsReceived: 0,
    audioBytesReceived: 0,
    audioConcealmentRatio: 0
  };

  if (latestAudioRow) {
    const audioSamplesReceived = safeDelta(latestAudioRow.totalSamplesReceived, baselineAudioRow?.totalSamplesReceived) ?? 0;
    const audioConcealedSamples = safeDelta(latestAudioRow.concealedSamples, baselineAudioRow?.concealedSamples) ?? 0;
    const audioSilentConcealedSamples = safeDelta(latestAudioRow.silentConcealedSamples, baselineAudioRow?.silentConcealedSamples) ?? 0;
    const audioConcealmentEvents = safeDelta(latestAudioRow.concealmentEvents, baselineAudioRow?.concealmentEvents) ?? 0;
    const audioPacketsLost = safeDelta(latestAudioRow.packetsLost, baselineAudioRow?.packetsLost) ?? 0;
    const audioPacketsDiscarded = safeDelta(latestAudioRow.packetsDiscarded, baselineAudioRow?.packetsDiscarded) ?? 0;
    const audioPacketsReceived = safeDelta(latestAudioRow.packetsReceived, baselineAudioRow?.packetsReceived) ?? 0;
    const audioBytesReceived = safeDelta(latestAudioRow.bytesReceived, baselineAudioRow?.bytesReceived) ?? 0;

    const audioConcealmentRatio = audioSamplesReceived > 0
      ? Number(((audioConcealedSamples / audioSamplesReceived) * 100).toFixed(2))
      : 0;

    audioMetrics = {
      audioSamplesReceived,
      audioConcealedSamples,
      audioSilentConcealedSamples,
      audioConcealmentEvents,
      audioPacketsLost,
      audioPacketsDiscarded,
      audioPacketsReceived,
      audioBytesReceived,
      audioConcealmentRatio
    };
  }

  const startupDynamics = {
    startupFreezes: baselineVideoRow?.freezeCount ?? 0,
    startupFreezeDurationSec: baselineVideoRow?.totalFreezesDuration ?? 0,
    startupFramesDropped: baselineVideoRow?.framesDropped ?? 0,
    startupFramesReceived: baselineVideoRow?.framesReceived ?? 0,
    startupFramesDecoded: baselineVideoRow?.framesDecoded ?? 0,
    startupPacketsLost: baselineVideoRow?.packetsLost ?? 0,
    startupPacketsReceived: baselineVideoRow?.packetsReceived ?? 0,
    startupAudioConcealedSamples: baselineAudioRow?.concealedSamples ?? 0,
    startupAudioTotalSamples: baselineAudioRow?.totalSamplesReceived ?? 0,
    startupAudioConcealmentEvents: baselineAudioRow?.concealmentEvents ?? 0,
    startupAudioPacketsLost: baselineAudioRow?.packetsLost ?? 0,
    startupAudioPacketsDiscarded: baselineAudioRow?.packetsDiscarded ?? 0
  };

  return {
    startupDynamics,
    steady: {
      freezeCount: steadyFreezes,
      totalFreezesDurationSec: steadyFreezeDurationSec,
      framesDropped: steadyFramesDropped,
      framesReceived: steadyFramesReceived,
      framesDecoded: steadyFramesDecoded,
      packetsLost: steadyPacketsLost,
      packetsReceived: steadyPacketsReceived,
      elapsedSteadySec: Number(Number(elapsedSteadySec).toFixed(2)),
      ...audioMetrics
    }
  };
}

export function evaluateQualityBudget({
  fpsMean,
  fpsP10,
  maxPauseMs,
  totalGapsCount,
  durationSec = 25,
  measuredDurationSec = null,
  totalPacketsLost = null,
  videoJitterMeanMs = null,
  freezeCount = null,
  totalFreezesDuration = null,
  audioPacketsLost = null,
  audioPacketsDiscarded = null,
  audioConcealmentRatio = null,
  expectAudible = false
} = {}) {
  const violations = [];
  const warnings = [];

  // 1. Cadência de FPS recebido (Alvo: 60.0 FPS)
  if (fpsMean == null || fpsMean < 45.0) {
    violations.push(`fps_critically_low: mean=${fpsMean ?? 'null'} < 45.0`);
  } else if (fpsMean < 55.0) {
    warnings.push(`fps_suboptimal: mean=${fpsMean} < 55.0`);
  }

  if (fpsP10 != null && fpsP10 < 40.0) {
    violations.push(`fps_p10_critically_low: p10=${fpsP10} < 40.0`);
  } else if (fpsP10 != null && fpsP10 < 50.0) {
    warnings.push(`fps_p10_degraded: p10=${fpsP10} < 50.0`);
  }

  // 2. Pausas na apresentação (Maior gap RVFC)
  if (maxPauseMs > 500) {
    violations.push(`severe_pause: maxPause=${maxPauseMs}ms > 500ms`);
  } else if (maxPauseMs > 250) {
    warnings.push(`moderate_pause: maxPause=${maxPauseMs}ms > 250ms`);
  }

  // 3. Frequência temporal de gaps (>100ms) normalizada por minuto usando duração efetiva
  const effectiveSec = (measuredDurationSec != null && measuredDurationSec > 0) ? measuredDurationSec : durationSec;
  const gapsPerMinute = effectiveSec > 0 ? Number(((totalGapsCount / effectiveSec) * 60).toFixed(1)) : 0;
  if (gapsPerMinute > 24.0) {
    violations.push(`excessive_gaps_rate: ${gapsPerMinute} gaps/min (count=${totalGapsCount} em ${effectiveSec.toFixed(1)}s) > 24.0/min`);
  } else if (gapsPerMinute > 8.0) {
    warnings.push(`frequent_gaps_rate: ${gapsPerMinute} gaps/min (count=${totalGapsCount} em ${effectiveSec.toFixed(1)}s) > 8.0/min`);
  }

  // 4. Freezes WebRTC na janela steady (deliberadamente descontando baseline de startup)
  if (freezeCount != null && freezeCount > 0) {
    if (totalFreezesDuration != null && totalFreezesDuration > 0.5) {
      violations.push(`webrtc_freezes_detected: count=${freezeCount}, duration=${totalFreezesDuration.toFixed(2)}s > 0.5s`);
    } else if (freezeCount > 2 || (totalFreezesDuration != null && totalFreezesDuration > 0.2)) {
      warnings.push(`webrtc_freezes_elevated: count=${freezeCount}, duration=${totalFreezesDuration?.toFixed(2) ?? 'null'}s`);
    }
  }

  // 5. Perda de pacotes WebRTC no vídeo (deliberadamente descontando baseline de startup)
  if (totalPacketsLost !== null && totalPacketsLost !== undefined) {
    if (totalPacketsLost > 0) {
      violations.push(`packet_loss_detected: lost=${totalPacketsLost}`);
    }
  }

  // 6. Jitter buffer de vídeo
  if (videoJitterMeanMs != null && videoJitterMeanMs > 50) {
    violations.push(`excessive_jitter_buffer: jitter=${videoJitterMeanMs}ms > 50ms`);
  } else if (videoJitterMeanMs != null && videoJitterMeanMs > 20) {
    warnings.push(`elevated_jitter_buffer: jitter=${videoJitterMeanMs}ms > 20ms`);
  }

  // 7. Qualidade de áudio na janela steady (quando audível)
  if (expectAudible) {
    if (audioPacketsLost != null && audioPacketsLost > 0) {
      violations.push(`audio_packet_loss: lost=${audioPacketsLost}`);
    }
    if (audioPacketsDiscarded != null && audioPacketsDiscarded > 0) {
      warnings.push(`audio_packets_discarded: discarded=${audioPacketsDiscarded}`);
    }
    if (audioConcealmentRatio != null && audioConcealmentRatio > 20.0) {
      warnings.push(`elevated_audio_concealment: ${audioConcealmentRatio}% > 20.0%`);
    }
  }

  let status = 'PASSED';
  if (violations.length > 0) {
    status = 'FAILED';
  } else if (warnings.length > 0) {
    status = 'DEGRADED';
  }

  return {
    status,
    violations,
    warnings,
    gapsPerMinute,
    effectiveDurationSec: Number(effectiveSec.toFixed(2)),
    budgetRules: {
      fpsMean: '>= 55.0 (PASS) / >= 45.0 (DEGRADED)',
      fpsP10: '>= 50.0 (PASS) / >= 40.0 (DEGRADED)',
      maxPauseMs: '<= 250ms (PASS) / <= 500ms (DEGRADED)',
      gapsPerMinute: '<= 8.0/min (PASS) / <= 24.0/min (DEGRADED)',
      webrtcSteadyFreezes: '0 or duration <= 0.2s (PASS) / <= 0.5s (DEGRADED)',
      videoPacketLoss: '0 (PASS, null=desconhecido)',
      audioPacketLoss: '0 (PASS)',
      audioConcealmentRatio: '<= 20.0% (PASS) / > 20.0% (DEGRADED)'
    }
  };
}
