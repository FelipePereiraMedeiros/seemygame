//! Native Direct3D 11 / GStreamer receiver pipeline for the desktop viewer.
//!
//! Contorna completamente o WebView2/Chromium na recepção, decodificação e exibição de vídeo:
//! WebRTC (webrtcbin) -> d3d11h264dec (GPU Zero-Copy) -> d3d11videosink (DXGI Flip Model / HWND).
//! Áudio: webrtcbin -> opusdec -> wasapisink (modo de ultra-baixa latência com AudioClient3).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_video::prelude::VideoOverlayExtManual;
use gstreamer_webrtc as gst_webrtc;
use serde::{Deserialize, Serialize};

#[cfg(not(test))]
use tauri::{AppHandle, Emitter, Manager};

use crate::media::GStreamerRuntime;
use crate::webrtc_bridge::{expand_local_candidates, sanitize_turn_uri, NativeCaptureSdp};

#[cfg(not(test))]
type ViewerAppHandle = AppHandle;
#[cfg(test)]
type ViewerAppHandle = ();

pub const NATIVE_VIEWER_EVENT: &str = "native-viewer-event";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NativeViewerEvent {
    pub host_id: String,
    pub event: String,
    pub mline_index: Option<u32>,
    pub candidate: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[allow(dead_code)]
pub struct NativeViewerState {
    pub active: bool,
    pub host_id: Option<String>,
    pub window_label: Option<String>,
    pub error: Option<String>,
}

static GSTREAMER_INITIALIZED: OnceLock<Result<(), String>> = OnceLock::new();

fn initialize_gstreamer(runtime: &GStreamerRuntime) -> Result<(), String> {
    runtime.prepare_process_environment();
    GSTREAMER_INITIALIZED
        .get_or_init(|| {
            gst::init().map_err(|error| format!("Falha ao inicializar GStreamer: {error}"))
        })
        .clone()
}

mod pipeline;
pub(crate) use pipeline::*;

mod render;
pub(crate) use render::*;

mod negotiation;
pub(crate) use negotiation::*;

// ---------------------------------------------------------------------------
// Comandos Tauri expostos para o Frontend
// ---------------------------------------------------------------------------

#[cfg(not(test))]
mod commands;
#[cfg(not(test))]
pub(crate) use commands::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_native_viewer_pipeline_instance() {
        let pipeline = NativeViewerPipeline::new(
            None,
            "test-host-123",
            None,
            Some(&["stun://stun.l.google.com:19302".to_string()]),
        );
        assert!(
            pipeline.is_ok(),
            "Falha ao instanciar NativeViewerPipeline: {:?}",
            pipeline.err()
        );
    }

    #[test]
    fn creates_answer_for_sample_offer() {
        let pipeline = NativeViewerPipeline::new(None, "test-host-offer", None, None)
            .expect("pipeline instance");

        let sample_offer = "\
v=0\r\n\
o=- 1234567890 2 IN IP4 127.0.0.1\r\n\
s=-\r\n\
t=0 0\r\n\
m=video 9 UDP/TLS/RTP/SAVPF 96\r\n\
c=IN IP4 0.0.0.0\r\n\
a=rtcp:9 IN IP4 0.0.0.0\r\n\
a=ice-ufrag:testufrag\r\n\
a=ice-pwd:testpassword1234567890\r\n\
a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\r\n\
a=setup:actpass\r\n\
a=mid:video0\r\n\
a=sendrecv\r\n\
a=rtcp-mux\r\n\
a=rtpmap:96 H264/90000\r\n";

        let answer = pipeline.create_answer(sample_offer);
        assert!(
            answer.is_ok(),
            "Falha ao criar resposta SDP no viewer: {:?}",
            answer.err()
        );
        let answer = answer.unwrap();
        assert_eq!(answer.sdp_type, "answer");
        assert!(answer.sdp.contains("m=video"));
    }
}
