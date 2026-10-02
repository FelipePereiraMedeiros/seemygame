//! Bounded replay of the existing H.264/Opus RTP. No decoder or encoder.
use gstreamer::{self as gst, prelude::*};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

const MAX_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone)]
struct Frame {
    buffer: gst::Buffer,
    caps: gst::Caps,
    video: bool,
}
impl Frame {
    fn pts(&self) -> u64 {
        self.buffer.pts().map(|t| t.nseconds()).unwrap_or(0)
    }
    fn keyframe(&self) -> bool {
        self.video && !self.buffer.flags().contains(gst::BufferFlags::DELTA_UNIT)
    }
}

pub(crate) struct ReplaySnapshot {
    frames: Vec<Frame>,
    has_audio: bool,
}
struct Ring {
    frames: VecDeque<Frame>,
    bytes: usize,
    seconds: u32,
    latest: u64,
}
impl Ring {
    fn push(&mut self, frame: Frame) {
        // A restarted worker has a new timeline. Never join incompatible runs.
        let changed_caps = frame.video
            && self
                .frames
                .iter()
                .rev()
                .find(|f| f.video)
                .is_some_and(|f| f.caps != frame.caps);
        if changed_caps || (frame.video && frame.pts().saturating_add(1_000_000_000) < self.latest)
        {
            self.frames.clear();
            self.bytes = 0;
            self.latest = 0;
        }
        self.latest = self.latest.max(frame.pts());
        self.bytes += frame.buffer.size();
        self.frames.push_back(frame);
        let cutoff = self
            .latest
            .saturating_sub(self.seconds as u64 * 1_000_000_000);
        while self.frames.front().is_some_and(|f| f.pts() < cutoff) || self.bytes > MAX_BYTES {
            if let Some(old) = self.frames.pop_front() {
                self.bytes -= old.buffer.size();
            } else {
                break;
            }
        }
    }
    fn snapshot(&self, has_audio: bool) -> Result<ReplaySnapshot, String> {
        let base = self
            .frames
            .iter()
            .find(|f| f.keyframe())
            .map(Frame::pts)
            .ok_or("Replay aguardando primeiro keyframe")?;
        let mut frames: Vec<_> = self
            .frames
            .iter()
            .filter(|f| f.pts() >= base)
            .cloned()
            .collect();
        frames.sort_by_key(Frame::pts);
        let audio_ready = frames.iter().any(|f| !f.video);
        if has_audio && !audio_ready {
            return Err("Replay aguardando áudio".into());
        }
        Ok(ReplaySnapshot { frames, has_audio })
    }
}

pub(crate) struct NativeReplay {
    pipeline: gst::Pipeline,
    ring: Arc<Mutex<Ring>>,
    pub(crate) video_port: u16,
    pub(crate) audio_port: Option<u16>,
}
impl NativeReplay {
    pub(crate) fn start(
        video_port: u16,
        audio_port: Option<u16>,
        seconds: u32,
    ) -> Result<Self, String> {
        let seconds = if seconds == 0 {
            120
        } else {
            seconds.clamp(5, 120)
        };
        let video = format!("udpsrc address=127.0.0.1 port={video_port} buffer-size=2097152 caps=\"application/x-rtp,media=video,encoding-name=H264,clock-rate=90000,payload=96\" ! rtpjitterbuffer latency=10 drop-on-latency=true ! rtph264depay wait-for-keyframe=true ! h264parse config-interval=-1 ! video/x-h264,stream-format=avc,alignment=au ! appsink name=video emit-signals=true sync=false max-buffers=4");
        let audio = audio_port.map(|port| format!(" udpsrc address=127.0.0.1 port={port} buffer-size=262144 caps=\"application/x-rtp,media=audio,encoding-name=OPUS,clock-rate=48000,payload=111,encoding-params=(string)2\" ! rtpjitterbuffer latency=10 drop-on-latency=true ! rtpopusdepay ! opusparse ! appsink name=audio emit-signals=true sync=false max-buffers=8")).unwrap_or_default();
        let pipeline = gst::parse::launch(&(video + &audio))
            .map_err(|e| e.to_string())?
            .downcast::<gst::Pipeline>()
            .map_err(|_| "Pipeline de replay inválido")?;
        let ring = Arc::new(Mutex::new(Ring {
            frames: VecDeque::new(),
            bytes: 0,
            seconds,
            latest: 0,
        }));
        for (name, is_video) in [("video", true), ("audio", false)] {
            if let Some(sink) = pipeline.by_name(name) {
                let ring = ring.clone();
                sink.connect("new-sample", false, move |values| {
                    let sink = values[0].get::<gst::Element>().unwrap();
                    if let Some(sample) =
                        sink.emit_by_name::<Option<gst::Sample>>("pull-sample", &[])
                    {
                        if let (Some(buffer), Some(caps)) = (sample.buffer(), sample.caps()) {
                            if buffer.pts().is_some() {
                                if let Ok(mut ring) = ring.lock() {
                                    ring.push(Frame {
                                        buffer: buffer.to_owned(),
                                        caps: caps.to_owned(),
                                        video: is_video,
                                    });
                                }
                            }
                        }
                    }
                    Some(gst::FlowReturn::Ok.to_value())
                });
            }
        }
        let replay = Self {
            pipeline,
            ring,
            video_port,
            audio_port,
        };
        replay
            .pipeline
            .set_state(gst::State::Playing)
            .map_err(|e| e.to_string())?;
        Ok(replay)
    }
    pub(crate) fn snapshot(&self) -> Result<ReplaySnapshot, String> {
        if let Some(message) = self
            .pipeline
            .bus()
            .and_then(|bus| bus.pop_filtered(&[gst::MessageType::Error]))
        {
            if let gst::MessageView::Error(error) = message.view() {
                return Err(format!("Replay: {}", error.error()));
            }
        }
        self.ring
            .lock()
            .map_err(|_| "Replay indisponível")?
            .snapshot(self.audio_port.is_some())
    }
}
impl Drop for NativeReplay {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

impl ReplaySnapshot {
    pub(crate) fn export(self) -> Result<Vec<u8>, String> {
        let pipeline = gst::Pipeline::new();
        let mux = gst::ElementFactory::make("mp4mux")
            .property("fragment-duration", 1000u32)
            .build()
            .map_err(|e| e.to_string())?;
        let sink = gst::ElementFactory::make("appsink")
            .property("sync", false)
            .property("emit-signals", true)
            .build()
            .map_err(|e| e.to_string())?;
        let bytes = Arc::new(Mutex::new(Vec::<u8>::new()));
        let result_bytes = bytes.clone();
        sink.connect("new-sample", false, move |values| {
            let sink = values[0].get::<gst::Element>().unwrap();
            if let Some(sample) = sink.emit_by_name::<Option<gst::Sample>>("pull-sample", &[]) {
                if let Some(buffer) = sample.buffer() {
                    if let Ok(map) = buffer.map_readable() {
                        if let Ok(mut output) = result_bytes.lock() {
                            if output.len() + map.size() > MAX_BYTES {
                                return Some(gst::FlowReturn::Error.to_value());
                            }
                            output.extend_from_slice(map.as_slice());
                        }
                    }
                }
            }
            Some(gst::FlowReturn::Ok.to_value())
        });
        pipeline
            .add_many([&mux, &sink])
            .map_err(|e| e.to_string())?;
        mux.link(&sink).map_err(|e| e.to_string())?;
        let mut sources = Vec::new();
        for video in [true, false] {
            if !video && !self.has_audio {
                continue;
            }
            let frame = self
                .frames
                .iter()
                .find(|f| f.video == video)
                .ok_or("Replay incompleto")?;
            let source = gst::ElementFactory::make("appsrc")
                .property("caps", &frame.caps)
                .property("format", gst::Format::Time)
                .property("block", false)
                .build()
                .map_err(|e| e.to_string())?;
            pipeline.add(&source).map_err(|e| e.to_string())?;
            let pad = mux
                .request_pad_simple(if video { "video_%u" } else { "audio_%u" })
                .ok_or("Muxer sem pad de mídia")?;
            source
                .static_pad("src")
                .ok_or("Appsrc sem saída")?
                .link(&pad)
                .map_err(|e| e.to_string())?;
            sources.push((video, source));
        }
        // RAII guarantees teardown even after a timeout or failed mux.
        struct Stop(gst::Pipeline);
        impl Drop for Stop {
            fn drop(&mut self) {
                let _ = self.0.set_state(gst::State::Null);
            }
        }
        let _stop = Stop(pipeline.clone());
        pipeline
            .set_state(gst::State::Playing)
            .map_err(|e| e.to_string())?;
        let base = self
            .frames
            .iter()
            .find(|f| f.keyframe())
            .ok_or("Replay sem keyframe")?
            .pts();
        for frame in self.frames {
            let source = &sources.iter().find(|(v, _)| *v == frame.video).unwrap().1;
            let mut buffer = frame.buffer.copy();
            let writable = buffer.make_mut();
            writable.set_pts(gst::ClockTime::from_nseconds(
                frame.pts().saturating_sub(base),
            ));
            writable.set_dts(
                frame
                    .buffer
                    .dts()
                    .map(|t| gst::ClockTime::from_nseconds(t.nseconds().saturating_sub(base))),
            );
            if source.emit_by_name::<gst::FlowReturn>("push-buffer", &[&buffer])
                != gst::FlowReturn::Ok
            {
                return Err("Falha ao montar clipe nativo".into());
            }
        }
        for (_, source) in sources {
            let _ = source.emit_by_name::<gst::FlowReturn>("end-of-stream", &[]);
        }
        let message = pipeline
            .bus()
            .unwrap()
            .timed_pop_filtered(
                gst::ClockTime::from_seconds(15),
                &[gst::MessageType::Eos, gst::MessageType::Error],
            )
            .ok_or("Tempo excedido ao montar clipe nativo")?;
        if let gst::MessageView::Error(error) = message.view() {
            return Err(format!(
                "{}: {} ({:?})",
                error.src().map(|s| s.path_string()).unwrap_or_default(),
                error.error(),
                error.debug()
            ));
        }
        let output = std::mem::take(&mut *bytes.lock().map_err(|_| "Clipe indisponível")?);
        if output.is_empty() {
            return Err("Replay ainda sem dados".into());
        }
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn initialize() {
        static INIT: std::sync::Once = std::sync::Once::new();
        INIT.call_once(|| {
            let runtime = crate::media::GStreamerRuntime::discover().unwrap();
            runtime.prepare_process_environment();
            gst::init().unwrap();
        });
    }
    fn frame(second: u64, key: bool, size: usize) -> Frame {
        initialize();
        let mut buffer = gst::Buffer::with_size(size).unwrap();
        let data = buffer.make_mut();
        data.set_pts(gst::ClockTime::from_seconds(second));
        if !key {
            data.set_flags(gst::BufferFlags::DELTA_UNIT);
        }
        Frame {
            buffer,
            caps: gst::Caps::new_empty(),
            video: true,
        }
    }
    #[test]
    fn history_starts_at_retained_keyframe_and_is_bounded() {
        let mut ring = Ring {
            frames: VecDeque::new(),
            bytes: 0,
            seconds: 5,
            latest: 0,
        };
        for t in 0..10 {
            ring.push(frame(t, t % 2 == 0, 20));
        }
        let snapshot = ring.snapshot(false).unwrap();
        assert_eq!(snapshot.frames[0].pts(), 4_000_000_000);
        assert!(snapshot.frames[0].keyframe());
        assert_eq!(ring.bytes, 120);
        assert!(ring.snapshot(true).is_err());
    }
    #[test]
    fn byte_limit_prunes_old_encoded_buffers() {
        let mut ring = Ring {
            frames: VecDeque::new(),
            bytes: 0,
            seconds: 120,
            latest: 0,
        };
        let shared = frame(1, true, MAX_BYTES / 4);
        for _ in 0..6 {
            ring.push(shared.clone());
        }
        assert_eq!(ring.bytes, MAX_BYTES);
        assert_eq!(ring.frames.len(), 4);
    }
    #[test]
    fn restart_and_missing_keyframe_do_not_export_stale_history() {
        let mut ring = Ring {
            frames: VecDeque::new(),
            bytes: 0,
            seconds: 5,
            latest: 0,
        };
        ring.push(frame(50, true, 20));
        ring.push(frame(0, false, 20));
        assert!(ring.snapshot(false).is_err());
        ring.push(frame(1, true, 20));
        assert_eq!(ring.snapshot(false).unwrap().frames.len(), 1);
    }

    #[test]
    fn real_rtp_replay_muxes_h264_and_opus_without_reencoding() {
        initialize();
        let allocate = || {
            let s = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
            s.local_addr().unwrap().port()
        };
        let video_port = allocate();
        let audio_port = allocate();
        let replay = NativeReplay::start(video_port, Some(audio_port), 5).unwrap();
        let source = gst::parse::launch(&format!("videotestsrc is-live=true pattern=ball ! video/x-raw,width=320,height=180,framerate=30/1 ! x264enc tune=zerolatency key-int-max=30 bframes=0 ! video/x-h264,profile=constrained-baseline ! rtph264pay pt=96 config-interval=-1 ! udpsink host=127.0.0.1 port={video_port} sync=false audiotestsrc is-live=true ! audio/x-raw,rate=48000,channels=2 ! opusenc ! rtpopuspay pt=111 ! udpsink host=127.0.0.1 port={audio_port} sync=false")).unwrap();
        struct Stop(gst::Element);
        impl Drop for Stop {
            fn drop(&mut self) {
                let _ = self.0.set_state(gst::State::Null);
            }
        }
        let _stop = Stop(source.clone());
        source.set_state(gst::State::Playing).unwrap();
        std::thread::sleep(std::time::Duration::from_secs(7));
        let snapshot = replay.snapshot().unwrap();
        assert!(snapshot.frames.iter().filter(|f| f.video).count() > 60);
        assert!(snapshot.frames.iter().any(|f| !f.video));
        assert!(snapshot.frames.last().unwrap().pts() - snapshot.frames[0].pts() <= 5_100_000_000);
        let bytes = snapshot.export().unwrap();
        assert!(bytes.windows(4).any(|b| b == b"ftyp"));
        assert!(bytes.windows(4).any(|b| b == b"avc1"));
        assert!(bytes.windows(4).any(|b| b == b"Opus"));
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../output/playwright/native-replay-h264-opus.mp4");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, bytes).unwrap();
        // A second export must not consume or stop the live replay buffer.
        assert!(!replay.snapshot().unwrap().export().unwrap().is_empty());
    }
}
