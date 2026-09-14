/**
 * SeeMyGame - Módulo de Bitrate Adaptativo Automático (ABR - Adaptive Bitrate)
 * Monitora telemetria WebRTC (perda de pacotes e latência RTT) e ajusta dinamicamente a taxa para evitar travamentos.
 */

export class AdaptiveBitrateController {
  constructor(options = {}) {
    this.targetBitrateBps = options.targetBitrateBps || 7500000;
    this.currentBitrateBps = this.targetBitrateBps;
    this.minBitrateBps = options.minBitrateBps || 1500000; // Mínimo 1.5 Mbps
    this.isEnabled = options.isEnabled !== false;
    this.onBitrateChange = options.onBitrateChange || null;

    this.consecutiveBadSamples = 0;
    this.consecutiveGoodSamples = 0;
    this.goodSamplesRequiredForRecovery = 4; // ~8 segundos de rede estável
  }

  setTargetBitrate(bps) {
    const val = Number(bps) || 7500000;
    this.targetBitrateBps = val;
    if (this.currentBitrateBps > val || !this.isEnabled) {
      this.currentBitrateBps = val;
    }
  }

  setEnabled(enabled) {
    this.isEnabled = !!enabled;
    if (!this.isEnabled) {
      this.currentBitrateBps = this.targetBitrateBps;
      if (this.onBitrateChange) {
        this.onBitrateChange(this.currentBitrateBps);
      }
    }
  }

  /**
   * Processa uma amostra de telemetria WebRTC
   * @param {Object} sample { packetLossRate: number, rttMs: number }
   * @returns {number} currentBitrateBps
   */
  processSample({ packetLossRate = 0, rttMs = 0 } = {}) {
    if (!this.isEnabled) return this.currentBitrateBps;

    const loss = Number(packetLossRate) || 0;
    const rtt = Number(rttMs) || 0;

    // Condição de instabilidade / congestionamento
    const isBadNetwork = (loss > 0.04) || (rtt > 220);
    // Condição de estabilidade e sobra de banda
    const isGoodNetwork = (loss < 0.01) && (rtt < 90);

    if (isBadNetwork) {
      this.consecutiveBadSamples++;
      this.consecutiveGoodSamples = 0;

      // Redução agressiva de 25% na primeira detecção
      if (this.currentBitrateBps > this.minBitrateBps) {
        const reduced = Math.max(this.minBitrateBps, Math.round(this.currentBitrateBps * 0.75));
        if (reduced !== this.currentBitrateBps) {
          this.currentBitrateBps = reduced;
          if (this.onBitrateChange) {
            this.onBitrateChange(this.currentBitrateBps);
          }
        }
      }
    } else if (isGoodNetwork && this.currentBitrateBps < this.targetBitrateBps) {
      this.consecutiveBadSamples = 0;
      this.consecutiveGoodSamples++;

      if (this.consecutiveGoodSamples >= this.goodSamplesRequiredForRecovery) {
        this.consecutiveGoodSamples = 0;
        // Recuperação gradual de 15%
        const increased = Math.min(this.targetBitrateBps, Math.round(this.currentBitrateBps * 1.15));
        if (increased !== this.currentBitrateBps) {
          this.currentBitrateBps = increased;
          if (this.onBitrateChange) {
            this.onBitrateChange(this.currentBitrateBps);
          }
        }
      }
    } else {
      this.consecutiveBadSamples = 0;
    }

    return this.currentBitrateBps;
  }
}

export const adaptiveBitrateController = new AdaptiveBitrateController();
