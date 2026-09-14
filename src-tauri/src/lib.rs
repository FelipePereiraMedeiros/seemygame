use tauri::Manager;

mod system;
mod windows_list;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Elevate process priority to HIGH_PRIORITY_CLASS to avoid GPU throttling
            let _ = system::set_high_priority();

            if let Some(window) = app.get_webview_window("main") {
                log::info!("[SeeMyGame Desktop] Janela 'main' inicializada com sucesso!");
                let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x: 100.0, y: 100.0 }));
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                // No paradigma de sala/Discord, a janela não fica travada forçadamente no topo por padrão,
                // permitindo que o usuário alterne dinamicamente conforme sua necessidade.
                let _ = window.set_always_on_top(false);
            } else {
                log::warn!("[SeeMyGame Desktop] Janela 'main' não encontrada pelo label!");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system::set_high_priority,
            windows_list::list_capturable_windows,
            system::toggle_always_on_top,
            system::is_always_on_top
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
