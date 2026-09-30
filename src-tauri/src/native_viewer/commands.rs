//! commands; internal to the native native_viewer subsystem.
use super::*;

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
pub fn add_native_viewer_candidate(mline_index: u32, candidate: String) -> Result<(), String> {
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
