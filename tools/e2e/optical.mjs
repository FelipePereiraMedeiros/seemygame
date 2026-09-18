/**
 * Codificação e decodificação óptica de timestamp, session magic e sequência de frames
 * para medição de latência Glass-to-Glass com garantia criptográfica contra falsos positivos.
 */

export const MARKER_CONFIG = {
  blockWidth: 8,
  blockHeight: 16,
  preamble: [1, 0, 1, 0, 1, 1, 0, 0], // 8 bits com autocorrelação distintiva
  magicBits: 16,
  seqBits: 24,
  timeBits: 32,
  checksumBits: 16,
  totalBits: 8 + 16 + 24 + 32 + 16 // 96 bits = 768px a 8px/bloco
};

/**
 * Cálculo canônico de CRC-16-CCITT (polinômio 0x1021, valor inicial 0xFFFF).
 *
 * @param {Uint8Array|number[]} bytes
 * @returns {number} Valor CRC de 16 bits (0..65535)
 */
export function crc16(bytes) {
  let crc = 0xFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc;
}

/**
 * Converte um texto ou ID de execução em um Session Magic ID numérico de 16 bits.
 *
 * @param {string|number} runId
 * @returns {number}
 */
export function computeSessionMagic(runId) {
  if (typeof runId === 'number') return runId & 0xFFFF;
  const str = String(runId || 'SMG');
  const buf = [];
  for (let i = 0; i < str.length; i++) buf.push(str.charCodeAt(i) & 0xFF);
  return crc16(buf);
}

/**
 * Renderiza o marcador óptico digital em um canvas 2D.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frameSeq Sequência numérica do frame (0..16777215)
 * @param {number} sourceTimeMs Timestamp em ms (Date.now())
 * @param {number|string} sessionMagic Magic ID de 16 bits da sessão
 * @param {object} config
 */
export function encodeOpticalMarker(ctx, frameSeq, sourceTimeMs, sessionMagic = 0, config = MARKER_CONFIG) {
  const magic = (typeof sessionMagic === 'string' ? computeSessionMagic(sessionMagic) : sessionMagic) & 0xFFFF;
  const seq = frameSeq & 0xFFFFFF; // 24 bits
  const time = (Math.floor(sourceTimeMs) >>> 0); // 32 bits sem sinal

  // 9 bytes de payload para cálculo do CRC16
  const payload = [
    (magic >> 8) & 0xFF,
    magic & 0xFF,
    (seq >> 16) & 0xFF,
    (seq >> 8) & 0xFF,
    seq & 0xFF,
    (time >>> 24) & 0xFF,
    (time >>> 16) & 0xFF,
    (time >>> 8) & 0xFF,
    time & 0xFF
  ];
  const checksum = crc16(payload);

  const bits = [...config.preamble];
  for (let i = 15; i >= 0; i--) bits.push((magic >> i) & 1);
  for (let i = 23; i >= 0; i--) bits.push((seq >> i) & 1);
  for (let i = 31; i >= 0; i--) bits.push((time >>> i) & 1);
  for (let i = 15; i >= 0; i--) bits.push((checksum >> i) & 1);

  const totalWidth = bits.length * config.blockWidth + 4;
  const totalHeight = config.blockHeight + 4;

  // Borda preta de contraste absoluto
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  // Blocos binários (preto = 0, branco = 1)
  for (let i = 0; i < bits.length; i++) {
    ctx.fillStyle = bits[i] === 1 ? '#FFFFFF' : '#000000';
    ctx.fillRect(2 + i * config.blockWidth, 2, config.blockWidth, config.blockHeight);
  }
}

/**
 * Decodifica o marcador óptico de um buffer RGBA com validação rigorosa de CRC-16
 * e Magic ID de sessão.
 *
 * @param {Uint8ClampedArray|number[]} rgba Buffer de pixels RGBA
 * @param {number} width Largura da imagem amostrada
 * @param {number} height Altura da imagem amostrada
 * @param {object} config
 * @param {number[]|null} candidateBlockWidths
 * @param {number|null} expectedMagic Magic ID esperado (opcional para filtro estrito)
 * @returns {{ frameSeq: number, sourceTimeMs: number, sessionMagic: number, detectedBlockWidth: number } | null}
 */
export function decodeOpticalMarker(
  rgba,
  width,
  height,
  config = MARKER_CONFIG,
  candidateBlockWidths = null,
  expectedMagic = null
) {
  const blockWidths = candidateBlockWidths && candidateBlockWidths.length > 0
    ? candidateBlockWidths
    : [config.blockWidth];

  const expectedMagicNum = expectedMagic != null
    ? (typeof expectedMagic === 'string' ? computeSessionMagic(expectedMagic) : expectedMagic & 0xFFFF)
    : null;

  for (const blockW of blockWidths) {
    const totalW = config.totalBits * blockW;
    if (totalW + 4 > width) continue;

    // Região de busca no topo do quadro (acomoda modo app e janelas com barra de título)
    const maxX = Math.min(width - totalW, 120);
    const maxY = Math.min(height - config.blockHeight, 160);

    for (let y = Math.max(2, Math.floor(config.blockHeight * 0.4)); y <= maxY; y += 3) {
      for (let startX = 0; startX <= maxX; startX += 2) {
        const lum = idx => {
          const off = (y * width + idx) * 4;
          return 0.299 * rgba[off] + 0.587 * rgba[off + 1] + 0.114 * rgba[off + 2];
        };

        // Validação do preâmbulo [1, 0, 1, 0, 1, 1, 0, 0]
        const p0 = lum(Math.floor(startX + 0.5 * blockW));
        const p1 = lum(Math.floor(startX + 1.5 * blockW));
        const p2 = lum(Math.floor(startX + 2.5 * blockW));
        const p3 = lum(Math.floor(startX + 3.5 * blockW));
        const p4 = lum(Math.floor(startX + 4.5 * blockW));
        const p5 = lum(Math.floor(startX + 5.5 * blockW));
        const p6 = lum(Math.floor(startX + 6.5 * blockW));
        const p7 = lum(Math.floor(startX + 7.5 * blockW));

        const whiteAvg = (p0 + p2 + p4 + p5) / 4;
        const blackAvg = (p1 + p3 + p6 + p7) / 4;
        if (whiteAvg - blackAvg < 50) continue;
        if (whiteAvg < 110 || blackAvg > 110) continue;

        const threshold = (whiteAvg + blackAvg) / 2;
        const bits = [];
        for (let i = 0; i < config.totalBits; i++) {
          const sx = Math.floor(startX + (i + 0.5) * blockW);
          if (sx >= width) break;
          bits.push(lum(sx) >= threshold ? 1 : 0);
        }
        if (bits.length < config.totalBits) continue;

        // Confirmação exata do preâmbulo de 8 bits
        if (
          bits[0] !== 1 || bits[1] !== 0 || bits[2] !== 1 || bits[3] !== 0 ||
          bits[4] !== 1 || bits[5] !== 1 || bits[6] !== 0 || bits[7] !== 0
        ) {
          continue;
        }

        // Leitura dos campos
        let magic = 0; for (let i = 8; i < 24; i++) magic = (magic << 1) | bits[i];
        if (expectedMagicNum != null && magic !== expectedMagicNum) continue;

        let seq = 0; for (let i = 24; i < 48; i++) seq = (seq << 1) | bits[i];
        let time = 0; for (let i = 48; i < 80; i++) time = ((time << 1) | bits[i]) >>> 0;
        let checksum = 0; for (let i = 80; i < 96; i++) checksum = (checksum << 1) | bits[i];

        // Validação criptográfica do CRC-16
        const payload = [
          (magic >> 8) & 0xFF,
          magic & 0xFF,
          (seq >> 16) & 0xFF,
          (seq >> 8) & 0xFF,
          seq & 0xFF,
          (time >>> 24) & 0xFF,
          (time >>> 16) & 0xFF,
          (time >>> 8) & 0xFF,
          time & 0xFF
        ];
        const expectedChecksum = crc16(payload);

        if (checksum === expectedChecksum) {
          return {
            frameSeq: seq,
            sourceTimeMs: time,
            sessionMagic: magic,
            detectedBlockWidth: blockW
          };
        }
      }
    }
  }
  return null;
}

/**
 * Calcula a latência visual em milissegundos sem ambiguidade temporal.
 * Com timestamp de 32 bits, o valor não sofre wrap durante testes.
 *
 * @param {number} currentEpochMs Timestamp atual (Date.now())
 * @param {number} sourceTime32Bits Timestamp de 32 bits recuperado do marcador
 * @returns {number} Latência visual estimada em milissegundos
 */
export function computeVisualLatency(currentEpochMs, sourceTime32Bits) {
  const current32 = (Math.floor(currentEpochMs) >>> 0);
  const diff = ((current32 - (sourceTime32Bits >>> 0)) | 0);
  return diff;
}
