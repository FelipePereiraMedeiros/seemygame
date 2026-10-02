// Rebase whole EBML clusters, never marker-like bytes inside compressed packets.
const CLUSTER = 0x1f43b675;
function vint(bytes, offset, keepMarker = false) {
  const first = bytes[offset];
  if (!first) return null;
  let width = 1, mask = 0x80;
  while (!(first & mask)) { width++; mask >>= 1; }
  if (width > 8 || offset + width > bytes.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let unknown = !keepMarker && value === mask - 1;
  for (let i = 1; i < width; i++) { value = value * 256 + bytes[offset + i]; unknown &&= bytes[offset + i] === 255; }
  return { value, width, unknown };
}
function element(bytes, offset, limit = bytes.length) {
  const id = vint(bytes, offset, true);
  const size = id && vint(bytes, offset + id.width);
  if (!id || !size) return null;
  const start = offset + id.width + size.width;
  const end = size.unknown ? limit : start + size.value;
  if (end > limit || end < start) return null;
  return { id: id.value, start, end, unknown: size.unknown, offset };
}
function unsigned(bytes, start, end) {
  let value = 0;
  for (let i = start; i < end; i++) value = value * 256 + bytes[i];
  return value;
}
function readCluster(bytes, offset, videoTrack) {
  const cluster = element(bytes, offset);
  if (!cluster || cluster.id !== CLUSTER) return null;
  let timecode = null, keyframe = false, blocks = 0, cursor = cluster.start;
  while (cursor < cluster.end) {
    const child = element(bytes, cursor, cluster.end);
    if (!child) break; // Ignore an incomplete final packet.
    if (child.id === CLUSTER && cluster.unknown) break;
    if (child.id === 0xe7) timecode = child;
    if (child.id === 0xa3) {
      const track = vint(bytes, child.start);
      if (track && child.start + track.width + 3 <= child.end) {
        blocks++;
        if (track.value === videoTrack && (bytes[child.start + track.width + 2] & 0x80)) keyframe = true;
      }
    }
    // Chromium also emits keyframes as BlockGroup/Block without a
    // ReferenceBlock; these do not carry the SimpleBlock keyframe flag.
    if (child.id === 0xa0) {
      let video = false, reference = false;
      for (let at = child.start; at < child.end;) {
        const field = element(bytes, at, child.end);
        if (!field) break;
        if (field.id === 0xa1) {
          const track = vint(bytes, field.start);
          if (track && field.start + track.width + 3 <= field.end) { blocks++; video = track.value === videoTrack; }
        }
        if (field.id === 0xfb) reference = true;
        at = field.end;
      }
      if (video && !reference) keyframe = true;
    }
    cursor = child.end;
  }
  if (!timecode || !blocks) return null;
  return { ...cluster, end: cursor, timecode, keyframe };
}
export function webmHeader(bytes) {
  let cursor = 0, videoTrack = 1;
  while (cursor < bytes.length) {
    if (vint(bytes, cursor, true)?.value === CLUSTER) return { header: bytes.slice(0, cursor), videoTrack };
    const item = element(bytes, cursor);
    if (!item) throw new Error('Cabeçalho WebM incompleto');
    if (item.id === CLUSTER) return { header: bytes.slice(0, cursor), videoTrack };
    if (item.id === 0x18538067) { cursor = item.start; continue; } // Segment
    if (item.id === 0x1654ae6b) { // Tracks
      for (let entryAt = item.start; entryAt < item.end;) {
        const entry = element(bytes, entryAt, item.end);
        if (!entry) break;
        let number, type;
        if (entry.id === 0xae) for (let at = entry.start; at < entry.end;) {
          const field = element(bytes, at, entry.end);
          if (!field) break;
          if (field.id === 0xd7) number = unsigned(bytes, field.start, field.end);
          if (field.id === 0x83) type = unsigned(bytes, field.start, field.end);
          at = field.end;
        }
        if (type === 1 && number) videoTrack = number;
        entryAt = entry.end;
      }
    }
    cursor = item.end;
  }
  return { header: bytes, videoTrack };
}
export function rebaseWebmClusters(bytes, videoTrack = 1) {
  let first = null;
  // A timeslice can start midway through a packet. Validate candidate markers
  // against their EBML children and require a video keyframe before retaining it.
  for (let at = 0; at + 5 < bytes.length; at++) {
    if (bytes[at] !== 0x1f || bytes[at + 1] !== 0x43 || bytes[at + 2] !== 0xb6 || bytes[at + 3] !== 0x75) continue;
    const candidate = readCluster(bytes, at, videoTrack);
    if (!candidate) continue;
    if (candidate.keyframe) { first = candidate; break; }
    at = candidate.end - 1;
  }
  if (!first) throw new Error('Replay ainda sem quadro-chave recente; aguarde e tente novamente');
  const base = unsigned(bytes, first.timecode.start, first.timecode.end);
  const output = bytes.slice(first.offset);
  let cursor = first.offset, validEnd = first.offset;
  while (cursor < bytes.length) {
    const cluster = readCluster(bytes, cursor, videoTrack);
    if (!cluster) break;
    let value = unsigned(bytes, cluster.timecode.start, cluster.timecode.end) - base;
    if (value < 0) throw new Error('Timestamp WebM retrocedeu');
    for (let at = cluster.timecode.end - 1; at >= cluster.timecode.start; at--) {
      output[at - first.offset] = value % 256; value = Math.floor(value / 256);
    }
    validEnd = cluster.end;
    cursor = cluster.end;
  }
  return output.slice(0, validEnd - first.offset);
}
