/**
 * SeeMyGame - Gerador de QR Code Leve em Canvas (Standalone, Zero-Dependency)
 * Baseado no padrão ISO/IEC 18004 (Byte Mode, Error Correction Level M).
 */

// Tabela de polinômios de Galois GF(256) com primitiva 0x11d (285)
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);
(function initGalois() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
})();

function gMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

function polyMul(p1, p2) {
  const result = new Uint8Array(p1.length + p2.length - 1);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= gMul(p1[i], p2[j]);
    }
  }
  return result;
}

function getGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    poly = polyMul(poly, new Uint8Array([1, EXP_TABLE[i]]));
  }
  return poly;
}

function calculateECC(data, eccLength) {
  const genPoly = getGeneratorPoly(eccLength);
  const remainder = new Uint8Array(data.length + eccLength);
  remainder.set(data);

  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i];
    if (factor !== 0) {
      for (let j = 0; j < genPoly.length; j++) {
        remainder[i + j] ^= gMul(genPoly[j], factor);
      }
    }
  }
  return remainder.slice(data.length);
}

// Capacidades para Nível de Correção M (Medium ~15%)
// [Versão, TotalCodewords, ECCodewords, DataCodewords]
const QR_VERSIONS = [
  null,
  { version: 1, size: 21, totalBytes: 26, ecBytes: 10, dataBytes: 16 },
  { version: 2, size: 25, totalBytes: 44, ecBytes: 16, dataBytes: 28 },
  { version: 3, size: 29, totalBytes: 70, ecBytes: 26, dataBytes: 44 },
  { version: 4, size: 33, totalBytes: 100, ecBytes: 36, dataBytes: 64 },
  { version: 5, size: 37, totalBytes: 134, ecBytes: 48, dataBytes: 86 },
  { version: 6, size: 41, totalBytes: 172, ecBytes: 64, dataBytes: 108 },
  { version: 7, size: 45, totalBytes: 196, ecBytes: 72, dataBytes: 124 },
  { version: 8, size: 49, totalBytes: 242, ecBytes: 88, dataBytes: 154 }
];

function selectVersion(dataLength) {
  // Overhead do modo byte: 4 bits modo + 8 bits tamanho (para ver 1-9) = 12 bits -> 1.5 bytes
  const requiredDataBytes = dataLength + 3;
  for (let v = 1; v < QR_VERSIONS.length; v++) {
    if (QR_VERSIONS[v].dataBytes >= requiredDataBytes) {
      return QR_VERSIONS[v];
    }
  }
  return QR_VERSIONS[QR_VERSIONS.length - 1];
}

class BitBuffer {
  constructor() {
    this.buffer = [];
    this.length = 0;
  }
  put(num, length) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }
  putBit(bit) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
    }
    this.length++;
  }
}

/**
 * Renderiza um QR Code em um elemento <canvas>
 * @param {HTMLCanvasElement} canvas
 * @param {string} text Conteúdo a ser codificado (URL da sala)
 * @param {Object} [options]
 * @param {number} [options.size=200] Largura e altura em pixels
 * @param {string} [options.darkColor='#ffffff'] Cor dos módulos escuros
 * @param {string} [options.lightColor='#1e1f29'] Cor do fundo
 */
export function renderQRCodeToCanvas(canvas, text, {
  size = 200,
  darkColor = '#ffffff',
  lightColor = '#181920'
} = {}) {
  if (!canvas || !text) return false;

  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(text);
  const verInfo = selectVersion(rawBytes.length);

  // 1. Bit Stream
  const bb = new BitBuffer();
  // Modo Byte (0100)
  bb.put(4, 4);
  // Tamanho dos dados (8 bits para versões 1 a 9)
  bb.put(rawBytes.length, 8);
  for (let i = 0; i < rawBytes.length; i++) {
    bb.put(rawBytes[i], 8);
  }
  // Terminador (até 4 zeros)
  const remainingBits = (verInfo.dataBytes * 8) - bb.length;
  bb.put(0, Math.min(4, Math.max(0, remainingBits)));

  // Alinhamento de byte
  while (bb.length % 8 !== 0) {
    bb.putBit(false);
  }

  // Padding bytes alternados (0xEC, 0x11)
  const padPatterns = [0xec, 0x11];
  let padIdx = 0;
  while (bb.buffer.length < verInfo.dataBytes) {
    bb.put(padPatterns[padIdx % 2], 8);
    padIdx++;
  }

  const dataCodewords = new Uint8Array(bb.buffer.slice(0, verInfo.dataBytes));
  const eccCodewords = calculateECC(dataCodewords, verInfo.ecBytes);

  // 2. Matriz do QR
  const dim = verInfo.size;
  const matrix = Array.from({ length: dim }, () => new Int8Array(dim).fill(-1));

  // Desenha Finder Patterns (3 cantos)
  const addFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr < 0 || nr >= dim || nc < 0 || nc >= dim) continue;
        if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
          matrix[nr][nc] = 1;
        } else {
          matrix[nr][nc] = 0;
        }
      }
    }
  };
  addFinder(0, 0);
  addFinder(0, dim - 7);
  addFinder(dim - 7, 0);

  // Timing patterns
  for (let i = 8; i < dim - 8; i++) {
    if (matrix[6][i] === -1) matrix[6][i] = (i % 2 === 0 ? 1 : 0);
    if (matrix[i][6] === -1) matrix[i][6] = (i % 2 === 0 ? 1 : 0);
  }

  // Dark module fixo
  matrix[4 * verInfo.version + 9][8] = 1;

  // Reserva de Format Info
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === -1) matrix[8][i] = 0;
    if (matrix[i][8] === -1) matrix[i][8] = 0;
    if (matrix[8][dim - 1 - i] === -1) matrix[8][dim - 1 - i] = 0;
    if (matrix[dim - 1 - i][8] === -1) matrix[dim - 1 - i][8] = 0;
  }

  // Preenche dados + ECC em zigue-zague
  const fullBytes = new Uint8Array(dataCodewords.length + eccCodewords.length);
  fullBytes.set(dataCodewords);
  fullBytes.set(eccCodewords, dataCodewords.length);

  let bitIdx = 0;
  const totalBits = fullBytes.length * 8;

  let dir = -1; // -1 sobe, +1 desce
  let col = dim - 1;
  while (col > 0) {
    if (col === 6) col--; // Pula timing vertical
    for (let count = 0; count < dim; count++) {
      const row = (dir === -1) ? (dim - 1 - count) : count;
      for (let c = 0; c < 2; c++) {
        const currCol = col - c;
        if (matrix[row][currCol] === -1) {
          let bit = 0;
          if (bitIdx < totalBits) {
            const byteVal = fullBytes[Math.floor(bitIdx / 8)];
            bit = (byteVal >>> (7 - (bitIdx % 8))) & 1;
            bitIdx++;
          }
          // Aplica Mask 0: (row + col) % 2 === 0
          const mask = ((row + currCol) % 2 === 0) ? 1 : 0;
          matrix[row][currCol] = bit ^ mask;
        }
      }
    }
    dir = -dir;
    col -= 2;
  }

  // Aplica Format Info para Nível M + Mask 0: 0x5412 ^ 0x5412 = 0 (101010000010010)
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  const formatMask = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  const maskedFormat = formatBits.map((b, i) => b ^ formatMask[i]);

  // Posiciona Format Info
  for (let i = 0; i < 6; i++) matrix[8][i] = maskedFormat[i];
  matrix[8][7] = maskedFormat[6];
  matrix[8][8] = maskedFormat[7];
  matrix[7][8] = maskedFormat[8];
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = maskedFormat[i];

  for (let i = 0; i < 8; i++) matrix[dim - 1 - i][8] = maskedFormat[i];
  for (let i = 8; i < 15; i++) matrix[8][dim - 15 + i] = maskedFormat[i];

  // 3. Renderização no Canvas
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const quietZone = 2;
  const totalModules = dim + (quietZone * 2);
  const cellSize = size / totalModules;

  ctx.fillStyle = lightColor;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = darkColor;
  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      if (matrix[r][c] === 1) {
        ctx.fillRect(
          Math.floor((c + quietZone) * cellSize),
          Math.floor((r + quietZone) * cellSize),
          Math.ceil(cellSize),
          Math.ceil(cellSize)
        );
      }
    }
  }

  return true;
}
