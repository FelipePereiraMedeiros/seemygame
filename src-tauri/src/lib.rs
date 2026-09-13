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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system::set_high_priority,
            windows_list::list_capturable_windows
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
