// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            use windows::Win32::System::Threading::{GetCurrentProcess, SetPriorityClass, HIGH_PRIORITY_CLASS};
            let _ = SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);
        }

        // Garante aceleração por hardware da GPU para codificação/decodificação WebRTC no WebView2
        let current_args =
            std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let gpu_args = "--enable-features=WebRtcHWEncoding,WebRtcHWDecoding --ignore-gpu-blocklist --enable-zero-copy --disable-features=WebRtcHideLocalIpsWithMdns --gpu-preferences=2";
        let combined = if current_args.is_empty() {
            gpu_args.to_string()
        } else {
            format!("{current_args} {gpu_args}")
        };
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", combined);
    }

    app_lib::run();
}
