//! pipeline; internal to the native native_viewer subsystem.
use super::*;

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

pub(crate) static ACTIVE_VIEWER: Mutex<Option<NativeViewerPipeline>> = Mutex::new(None);

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
                    let formatted =
                        if trimmed.starts_with("turn://") || trimmed.starts_with("turns://") {
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
                    crate::system::write_debug_log(&format!(
                        "[NativeViewer Pipeline ERROR] {detail}"
                    ));
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
                    crate::system::write_debug_log(&format!(
                        "[NativeViewer Pipeline WARNING] {detail}"
                    ));
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
            .map_err(|error| {
                format!("Falha ao iniciar reprodução do visualizador nativo: {error}")
            })?;

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

    pub(crate) fn ensure_healthy(&self) -> Result<(), String> {
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
