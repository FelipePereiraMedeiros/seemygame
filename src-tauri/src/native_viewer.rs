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
use crate::webrtc_bridge::{
    expand_local_candidates, sanitize_turn_uri, NativeCaptureSdp,
};

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

#[allow(dead_code)]
pub struct NativeViewerPipeline {
    pub host_id: String,
    pub pipeline: gst::Pipeline,
    pub webrtc: gst::Element,
    pub window_handle: Option<usize>,
    pub error_state: Arc<Mutex<Option<String>>>,
    pub shutdown: Arc<AtomicBool>,
    pub bus_thread: Option<JoinHandle<()>>,
}

static ACTIVE_VIEWER: Mutex<Option<NativeViewerPipeline>> = Mutex::new(None);

impl NativeViewerPipeline {
    pub fn new(
        app: Option<&ViewerAppHandle>,
        host_id: impl Into<String>,
        window_handle: Option<usize>,
        ice_servers: Option<&[String]>,
    ) -> Result<Self, String> {
        let host_id = host_id.into();
        #[cfg(test)]
        let _ = &app;

        let runtime = GStreamerRuntime::discover().ok_or_else(|| {
            "Runtime GStreamer empacotado não encontrado para o visualizador nativo".to_string()
        })?;
        let capabilities = runtime.probe();
        if !capabilities.webrtc_available {
            return Err("Plugin GStreamer webrtcbin não está disponível".to_string());
        }
        initialize_gstreamer(&runtime)?;

        let pipeline = gst::Pipeline::new();
        let webrtc = gst::ElementFactory::make("webrtcbin")
            .name("seemygame-viewer-webrtc")
            .build()
            .map_err(|error| format!("Falha ao criar webrtcbin: {error}"))?;

        webrtc.set_property_from_str("bundle-policy", "max-bundle");
        // Latência zero no jitter buffer para priorizar o tempo real estrito
        webrtc.set_property("latency", 0u32);

        let mut stun_set = false;
        if let Some(servers) = ice_servers {
            for server in servers {
                let trimmed = server.trim();
                if trimmed.starts_with("stun:") || trimmed.starts_with("stun://") {
                    let formatted = if trimmed.starts_with("stun://") {
                        trimmed.to_string()
                    } else {
                        format!("stun://{}", &trimmed[5..])
                    };
                    if !stun_set {
                        webrtc.set_property("stun-server", &formatted);
                        stun_set = true;
                    }
                } else if trimmed.starts_with("turn:")
                    || trimmed.starts_with("turns:")
                    || trimmed.starts_with("turn://")
                    || trimmed.starts_with("turns://")
                {
                    let formatted = if trimmed.starts_with("turn://") || trimmed.starts_with("turns://") {
                        trimmed.to_string()
                    } else if let Some(rest) = trimmed.strip_prefix("turns:") {
                        format!("turns://{rest}")
                    } else if let Some(rest) = trimmed.strip_prefix("turn:") {
                        format!("turn://{rest}")
                    } else {
                        trimmed.to_string()
                    };
                    let sanitized = sanitize_turn_uri(&formatted);
                    #[cfg(not(test))]
                    crate::system::write_debug_log(&format!(
                        "[NativeViewer] webrtcbin adicionando servidor TURN: {sanitized}"
                    ));
                    let _ = webrtc.emit_by_name::<bool>("add-turn-server", &[&formatted]);
                }
            }
        }
        if !stun_set {
            webrtc.set_property_from_str("stun-server", "stun://stun.l.google.com:19302");
        }

        pipeline
            .add(&webrtc)
            .map_err(|error| format!("Falha ao adicionar webrtcbin: {error}"))?;

        let error_state = Arc::new(Mutex::new(None));
        let shutdown = Arc::new(AtomicBool::new(false));
        let bus = pipeline
            .bus()
            .ok_or_else(|| "Pipeline do visualizador sem bus de mensagens".to_string())?;
        let bus_error_state = Arc::clone(&error_state);
        let bus_shutdown = Arc::clone(&shutdown);

        let bus_thread = thread::spawn(move || loop {
            if bus_shutdown.load(Ordering::Relaxed) {
                break;
            }
            let Some(message) = bus.timed_pop(Some(gst::ClockTime::from_mseconds(250))) else {
                continue;
            };
            match message.view() {
                gst::MessageView::Error(error) => {
                    let detail = error
                        .debug()
                        .map(|debug| format!("{} ({debug})", error.error()))
                        .unwrap_or_else(|| error.error().to_string());
                    #[cfg(not(test))]
                    crate::system::write_debug_log(&format!("[NativeViewer Pipeline ERROR] {detail}"));
                    if let Ok(mut state) = bus_error_state.lock() {
                        *state = Some(detail);
                    }
                    break;
                }
                gst::MessageView::Warning(warning) => {
                    let detail = warning
                        .debug()
                        .map(|debug| format!("{} ({debug})", warning.error()))
                        .unwrap_or_else(|| warning.error().to_string());
                    #[cfg(not(test))]
                    crate::system::write_debug_log(&format!("[NativeViewer Pipeline WARNING] {detail}"));
                }
                gst::MessageView::Eos(..) => break,
                _ => {}
            }
        });

        // Configuração de emissão de candidatos ICE locais do visualizador
        #[cfg(not(test))]
        if let Some(event_app) = app.cloned() {
            let event_host_id = host_id.clone();
            webrtc.connect("on-ice-candidate", false, move |values| {
                let mline_index = values.get(1).and_then(|v| v.get::<u32>().ok());
                let candidate = values.get(2).and_then(|v| v.get::<String>().ok());
                if let Some(cand_str) = candidate {
                    for cand in expand_local_candidates(&cand_str) {
                        crate::system::write_debug_log(&format!(
                            "[NativeViewer] Candidato ICE gerado para host {event_host_id} (mline={mline_index:?}): {cand}"
                        ));
                        let event = NativeViewerEvent {
                            host_id: event_host_id.clone(),
                            event: "ice-candidate".to_string(),
                            mline_index,
                            candidate: Some(cand),
                            message: None,
                        };
                        let _ = event_app.emit(NATIVE_VIEWER_EVENT, event);
                    }
                }
                None
            });
        }

        // Conecta o handler de pads dinâmicos quando a trilha remota é recebida
        let pipeline_weak = pipeline.downgrade();
        let target_hwnd = window_handle;
        webrtc.connect_pad_added(move |_webrtc, pad| {
            let Some(pipe) = pipeline_weak.upgrade() else {
                return;
            };
            if let Err(err) = handle_incoming_stream_pad(&pipe, pad, target_hwnd) {
                #[cfg(not(test))]
                crate::system::write_debug_log(&format!(
                    "[NativeViewer] Erro ao conectar pad de mídia recebido: {err}"
                ));
                let _ = err;
            }
        });

        pipeline
            .set_state(gst::State::Paused)
            .map_err(|error| format!("Falha ao preparar pipeline do visualizador: {error}"))?;

        Ok(Self {
            host_id,
            pipeline,
            webrtc,
            window_handle,
            error_state,
            shutdown,
            bus_thread: Some(bus_thread),
        })
    }

    pub fn create_answer(&self, offer_sdp: &str) -> Result<NativeCaptureSdp, String> {
        self.ensure_healthy()?;
        let sdp = gst_webrtc::gst_sdp::SDPMessage::parse_buffer(offer_sdp.as_bytes())
            .map_err(|error| format!("Oferta SDP inválida: {error}"))?;
        let offer =
            gst_webrtc::WebRTCSessionDescription::new(gst_webrtc::WebRTCSDPType::Offer, sdp);

        let set_remote_promise = gst::Promise::new();
        self.webrtc
            .emit_by_name::<()>("set-remote-description", &[&offer, &set_remote_promise]);
        wait_promise(&set_remote_promise, "aplicar oferta SDP no visualizador")?;

        let answer_promise = gst::Promise::new();
        self.webrtc
            .emit_by_name::<()>("create-answer", &[&None::<gst::Structure>, &answer_promise]);
        let answer_reply = wait_promise(&answer_promise, "criar resposta SDP do visualizador")?
            .ok_or_else(|| "webrtcbin não retornou resposta SDP".to_string())?;
        let answer = answer_reply
            .get::<gst_webrtc::WebRTCSessionDescription>("answer")
            .map_err(|error| format!("Resposta SDP ausente no retorno: {error}"))?;

        let set_local_promise = gst::Promise::new();
        self.webrtc
            .emit_by_name::<()>("set-local-description", &[&answer, &set_local_promise]);
        wait_promise(&set_local_promise, "aplicar resposta SDP local")?;

        self.pipeline
            .set_state(gst::State::Playing)
            .map_err(|error| format!("Falha ao iniciar reprodução do visualizador nativo: {error}"))?;

        Ok(NativeCaptureSdp {
            sdp_type: "answer".to_string(),
            sdp: answer.sdp().as_text().map_err(|err| err.to_string())?,
        })
    }

    pub fn add_ice_candidate(&self, mline_index: u32, candidate: &str) -> Result<(), String> {
        self.ensure_healthy()?;
        self.webrtc
            .emit_by_name::<()>("add-ice-candidate", &[&mline_index, &candidate]);
        Ok(())
    }

    fn ensure_healthy(&self) -> Result<(), String> {
        let state = self
            .error_state
            .lock()
            .map_err(|_| "Estado do visualizador indisponível".to_string())?;
        if let Some(error) = state.as_ref() {
            return Err(format!("Pipeline do visualizador nativo falhou: {error}"));
        }
        Ok(())
    }
}

impl Drop for NativeViewerPipeline {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        let _ = self.pipeline.set_state(gst::State::Null);
        if let Some(thread) = self.bus_thread.take() {
            let _ = thread.join();
        }
    }
}

fn handle_incoming_stream_pad(
    pipeline: &gst::Pipeline,
    pad: &gst::Pad,
    window_handle: Option<usize>,
) -> Result<(), String> {
    let caps = pad
        .current_caps()
        .or_else(|| Some(pad.query_caps(None)))
        .ok_or_else(|| "Pad recebido sem caps definidas".to_string())?;
    let structure = caps
        .structure(0)
        .ok_or_else(|| "Estrutura de caps inválida no pad recebido".to_string())?;
    let media = structure
        .get::<&str>("media")
        .unwrap_or_default();

    if media == "video" {
        #[cfg(not(test))]
        crate::system::write_debug_log(
            "[NativeViewer] Conectando branch de vídeo Direct3D 11 nativo com Zero-Copy..."
        );

        let depay = gst::ElementFactory::make("rtph264depay").build()
            .map_err(|e| format!("Falha ao criar rtph264depay: {e}"))?;
        let parse = gst::ElementFactory::make("h264parse").build()
            .map_err(|e| format!("Falha ao criar h264parse: {e}"))?;

        // Tenta selecionar decodificador Direct3D 11 de hardware na GPU; se indisponível, usa fallback CPU
        let decoder = gst::ElementFactory::make("d3d11h264dec")
            .build()
            .or_else(|_| gst::ElementFactory::make("openh264dec").build())
            .map_err(|e| format!("Falha ao instanciar decodificador H.264: {e}"))?;

        let queue = gst::ElementFactory::make("queue").build()
            .map_err(|e| format!("Falha ao criar queue de vídeo: {e}"))?;
        queue.set_property("max-size-buffers", 1u32);
        queue.set_property("drop-oldest", true);

        // Sink de vídeo: d3d11videosink para renderização direta em SwapChain DXGI do Windows
        let sink = gst::ElementFactory::make("d3d11videosink")
            .build()
            .or_else(|_| gst::ElementFactory::make("autovideosink").build())
            .map_err(|e| format!("Falha ao instanciar sink de vídeo nativo: {e}"))?;

        sink.set_property("sync", false);

        // Se houver um HWND nativo especificado, acopla o sink à janela Win32
        if let Some(hwnd) = window_handle {
            if let Ok(overlay) = sink.clone().dynamic_cast::<gstreamer_video::VideoOverlay>() {
                unsafe {
                    overlay.set_window_handle(hwnd);
                }
            }
        }

        pipeline.add_many([&depay, &parse, &decoder, &queue, &sink])
            .map_err(|e| format!("Falha ao adicionar elementos de vídeo ao pipeline: {e}"))?;

        depay.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        parse.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        decoder.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        queue.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        sink.sync_state_with_parent().map_err(|e| format!("{e}"))?;

        gst::Element::link_many([&depay, &parse, &decoder, &queue, &sink])
            .map_err(|e| format!("Falha ao interligar elementos de vídeo: {e}"))?;

        let sink_pad = depay.static_pad("sink")
            .ok_or_else(|| "rtph264depay sem sink pad".to_string())?;
        pad.link(&sink_pad)
            .map_err(|e| format!("Falha ao ligar pad de vídeo ao depayloader: {e}"))?;
    } else if media == "audio" {
        #[cfg(not(test))]
        crate::system::write_debug_log(
            "[NativeViewer] Conectando branch de áudio WASAPI nativo com modo low-latency..."
        );

        let depay = gst::ElementFactory::make("rtpopusdepay").build()
            .map_err(|e| format!("Falha ao criar rtpopusdepay: {e}"))?;
        let decoder = gst::ElementFactory::make("opusdec").build()
            .map_err(|e| format!("Falha ao criar opusdec: {e}"))?;
        let convert = gst::ElementFactory::make("audioconvert").build()
            .map_err(|e| format!("Falha ao criar audioconvert: {e}"))?;
        let resample = gst::ElementFactory::make("audioresample").build()
            .map_err(|e| format!("Falha ao criar audioresample: {e}"))?;

        let sink = gst::ElementFactory::make("wasapisink")
            .build()
            .or_else(|_| gst::ElementFactory::make("autoaudiosink").build())
            .map_err(|e| format!("Falha ao criar sink de áudio: {e}"))?;

        sink.set_property("sync", false);
        if sink.has_property("low-latency") {
            sink.set_property("low-latency", true);
        }
        if sink.has_property("use-audioclient3") {
            sink.set_property("use-audioclient3", true);
        }

        pipeline.add_many([&depay, &decoder, &convert, &resample, &sink])
            .map_err(|e| format!("Falha ao adicionar elementos de áudio ao pipeline: {e}"))?;

        depay.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        decoder.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        convert.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        resample.sync_state_with_parent().map_err(|e| format!("{e}"))?;
        sink.sync_state_with_parent().map_err(|e| format!("{e}"))?;

        gst::Element::link_many([&depay, &decoder, &convert, &resample, &sink])
            .map_err(|e| format!("Falha ao interligar elementos de áudio: {e}"))?;

        let sink_pad = depay.static_pad("sink")
            .ok_or_else(|| "rtpopusdepay sem sink pad".to_string())?;
        pad.link(&sink_pad)
            .map_err(|e| format!("Falha ao ligar pad de áudio ao depayloader: {e}"))?;
    }

    Ok(())
}

fn wait_promise(promise: &gst::Promise, operation: &str) -> Result<Option<gst::Structure>, String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let promise_for_wait = promise.clone();
    let worker = thread::spawn(move || {
        let result = match promise_for_wait.wait() {
            gst::PromiseResult::Replied => Ok(promise_for_wait.get_reply().map(ToOwned::to_owned)),
            gst::PromiseResult::Interrupted => Err("interrupted".to_string()),
            gst::PromiseResult::Expired => Err("expired".to_string()),
            result => Err(format!("{result:?}")),
        };
        let _ = sender.send(result);
    });

    match receiver.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(reply)) => {
            let _ = worker.join();
            Ok(reply)
        }
        Ok(Err(reason)) => {
            let _ = worker.join();
            Err(format!("webrtcbin falhou ao {operation}: {reason}"))
        }
        Err(_) => {
            promise.expire();
            let _ = worker.join();
            Err(format!(
                "Tempo limite de 5s excedido esperando webrtcbin para {operation}"
            ))
        }
    }
}

// ---------------------------------------------------------------------------
// Comandos Tauri expostos para o Frontend
// ---------------------------------------------------------------------------

#[cfg(not(test))]
#[tauri::command]
pub fn start_native_viewer(
    app: AppHandle,
    host_id: String,
    offer_sdp: String,
    ice_servers: Option<Vec<String>>,
    open_dedicated_window: Option<bool>,
) -> Result<NativeCaptureSdp, String> {
    crate::system::write_debug_log(&format!(
        "[NativeViewer] start_native_viewer chamado para host {host_id} (sdp_len={})",
        offer_sdp.len()
    ));

    let window_handle = if open_dedicated_window.unwrap_or(true) {
        let label = "native-player";
        let window = if let Some(existing) = app.get_webview_window(label) {
            existing
        } else {
            tauri::WebviewWindowBuilder::new(
                &app,
                label,
                tauri::WebviewUrl::App("about:blank".into()),
            )
            .title("SeeMyGame • Player Nativo D3D11 (Ultra Baixa Latência)")
            .inner_size(1280.0, 720.0)
            .decorations(true)
            .build()
            .map_err(|e| format!("Falha ao criar janela do player nativo: {e}"))?
        };
        let _ = window.show();
        let _ = window.set_focus();
        window.hwnd().ok().map(|h| h.0 as usize)
    } else {
        None
    };

    let session = NativeViewerPipeline::new(
        Some(&app),
        host_id.clone(),
        window_handle,
        ice_servers.as_deref(),
    )?;

    let answer = session.create_answer(&offer_sdp)?;

    let mut guard = ACTIVE_VIEWER
        .lock()
        .map_err(|_| "Estado do visualizador nativo indisponível".to_string())?;
    *guard = Some(session);

    Ok(answer)
}

#[cfg(not(test))]
#[tauri::command]
pub fn add_native_viewer_candidate(
    mline_index: u32,
    candidate: String,
) -> Result<(), String> {
    let guard = ACTIVE_VIEWER
        .lock()
        .map_err(|_| "Estado do visualizador nativo indisponível".to_string())?;
    if let Some(session) = guard.as_ref() {
        for cand in expand_local_candidates(&candidate) {
            session.add_ice_candidate(mline_index, &cand)?;
        }
    }
    Ok(())
}

#[cfg(not(test))]
#[tauri::command]
pub fn stop_native_viewer(app: AppHandle) -> Result<(), String> {
    crate::system::write_debug_log("[NativeViewer] Encerrando visualizador nativo...");
    let mut guard = ACTIVE_VIEWER
        .lock()
        .map_err(|_| "Estado do visualizador nativo indisponível".to_string())?;
    if let Some(session) = guard.take() {
        session.shutdown.store(true, Ordering::Relaxed);
        let _ = session.pipeline.set_state(gst::State::Null);
    }
    if let Some(window) = app.get_webview_window("native-player") {
        let _ = window.close();
    }
    Ok(())
}

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
        assert!(pipeline.is_ok(), "Falha ao instanciar NativeViewerPipeline: {:?}", pipeline.err());
    }

    #[test]
    fn creates_answer_for_sample_offer() {
        let pipeline = NativeViewerPipeline::new(
            None,
            "test-host-offer",
            None,
            None,
        ).expect("pipeline instance");

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
        assert!(answer.is_ok(), "Falha ao criar resposta SDP no viewer: {:?}", answer.err());
        let answer = answer.unwrap();
        assert_eq!(answer.sdp_type, "answer");
        assert!(answer.sdp.contains("m=video"));
    }
}
