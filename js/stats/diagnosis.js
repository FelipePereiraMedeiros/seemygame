/** Hypotheses, not causal proof. Missing measurements never imply a healthy stage. */
export function diagnoseSample(sample) {
  const budget = 1000 / (sample.requestedFps || 60);
  if (sample.sampleError) return { stage: 'instrumentation', confidence: 'high', message: 'Sem amostra WebRTC' };
  if (sample.qualityReason === 'cpu' || sample.encodeTimeMs > budget * 1.2) return { stage: 'encoder', confidence: 'medium', message: 'Investigue carga do encoder e resolução' };
  if (sample.qualityReason === 'bandwidth' || sample.packetLossRate > .04) return { stage: 'network', confidence: 'medium', message: 'Investigue banda, perda e bitrate' };
  if (Number.isFinite(sample.producedFps) && sample.requestedFps && sample.producedFps < sample.requestedFps * .85) return { stage: 'native-producer', confidence: 'medium', message: 'Cadência baixa antes da ponte WebRTC' };
  if (sample.maxPauseMs > 100 && sample.measuredFps >= (sample.requestedFps || 60) * .85) return { stage: 'presentation', confidence: 'medium', message: 'Pausa na apresentação com decode ativo' };
  if (sample.jitterBufferDelayMs > 50 && sample.maxPauseMs > 100) return { stage: 'receiver-buffer', confidence: 'low', message: 'Investigue jitter e sincronização A/V' };
  return { stage: 'undetermined', confidence: 'low', message: 'Sem gargalo identificado nesta amostra' };
}
