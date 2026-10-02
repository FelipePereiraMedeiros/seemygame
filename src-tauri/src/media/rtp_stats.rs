//! Count encoded video access units at the worker handoff, without decoding or GPU readback.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug)]
pub(crate) struct RtpCounters {
    start: Instant,
    packets: AtomicU64,
    bytes: AtomicU64,
    frames: AtomicU64,
    last_frame_us: AtomicU64,
    max_gap_us: AtomicU64,
    marker: Mutex<Option<(u32, u32)>>,
}
impl Default for RtpCounters {
    fn default() -> Self {
        Self { start: Instant::now(), packets: AtomicU64::new(0), bytes: AtomicU64::new(0), frames: AtomicU64::new(0), last_frame_us: AtomicU64::new(0), max_gap_us: AtomicU64::new(0), marker: Mutex::new(None) }
    }
}
impl RtpCounters {
    pub(crate) fn observe(&self, packet: &[u8]) {
        if packet.len() < 12 || packet[0] >> 6 != 2 { return; }
        self.packets.fetch_add(1, Ordering::Relaxed);
        self.bytes.fetch_add(packet.len() as u64, Ordering::Relaxed);
        if packet[1] & 0x80 == 0 { return; }
        // RTP marker completes an H264/H265/AV1 access unit, not each fragmented packet.
        let timestamp = u32::from_be_bytes(packet[4..8].try_into().unwrap());
        let ssrc = u32::from_be_bytes(packet[8..12].try_into().unwrap());
        let Ok(mut marker) = self.marker.lock() else { return; };
        if *marker == Some((ssrc, timestamp)) { return; }
        *marker = Some((ssrc, timestamp));
        let now = self.start.elapsed().as_micros().min(u64::MAX as u128) as u64;
        let previous = self.last_frame_us.swap(now, Ordering::Relaxed);
        if self.frames.fetch_add(1, Ordering::Relaxed) > 0 {
            self.max_gap_us.fetch_max(now.saturating_sub(previous), Ordering::Relaxed);
        }
    }
    pub(crate) fn snapshot(&self) -> serde_json::Value {
        let frames = self.frames.load(Ordering::Relaxed);
        serde_json::json!({"id":"capture-worker", "type":"native-pipeline",
            "framesProduced":frames, "packetsProduced":self.packets.load(Ordering::Relaxed), "bytesProduced":self.bytes.load(Ordering::Relaxed),
            "producerFrameAgeMs":if frames>0 { Some(self.start.elapsed().as_micros().saturating_sub(self.last_frame_us.load(Ordering::Relaxed) as u128) as f64/1000.0) } else { None },
            "producerMaxPauseMs":self.max_gap_us.load(Ordering::Relaxed) as f64/1000.0 })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_rtp_and_duplicate_marker_count_only_one_completed_frame() {
        let counter = RtpCounters::default();
        let mut packet = [0u8; 13]; packet[0]=0x80;packet[1]=96;
        counter.observe(&packet);assert_eq!(counter.snapshot()["framesProduced"],0);
        packet[1]|=0x80;counter.observe(&packet);counter.observe(&packet);
        assert_eq!(counter.snapshot()["framesProduced"],1);
        packet[7]=1;counter.observe(&packet);assert_eq!(counter.snapshot()["framesProduced"],2);
        assert_eq!(counter.snapshot()["packetsProduced"],4);
    }
    #[test]
    fn invalid_header_and_incomplete_packets_are_ignored() {
        let counter = RtpCounters::default();counter.observe(&[0;8]);counter.observe(&[0;20]);
        assert_eq!(counter.snapshot()["packetsProduced"],0);
        assert!(counter.snapshot()["producerFrameAgeMs"].is_null());
    }
}
