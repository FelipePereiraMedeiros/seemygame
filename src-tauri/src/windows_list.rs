use serde::Serialize;
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
};

#[derive(Debug, Serialize, Clone)]
pub struct CapturableWindow {
    pub id: String,
    pub title: String,
    pub process_name: String,
    pub is_minimized: bool,
}

struct EnumState {
    windows: Vec<CapturableWindow>,
}

unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut EnumState);

    if !IsWindowVisible(hwnd).as_bool() {
        return BOOL(1);
    }

    let length = GetWindowTextLengthW(hwnd);
    if length == 0 {
        return BOOL(1);
    }

    // Skip cloaked windows (hidden UWP or virtual desktop apps)
    let mut cloaked: u32 = 0;
    let hr = DwmGetWindowAttribute(
        hwnd,
        DWMWA_CLOAKED,
        &mut cloaked as *mut _ as *mut _,
        std::mem::size_of::<u32>() as u32,
    );
    if hr.is_ok() && cloaked != 0 {
        return BOOL(1);
    }

    // Skip tool windows
    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
    if (ex_style & WS_EX_TOOLWINDOW.0 as i32) != 0 {
        return BOOL(1);
    }

    // Get window title
    let mut text_buf = vec![0u16; (length + 1) as usize];
    let copied = GetWindowTextW(hwnd, &mut text_buf);
    if copied == 0 {
        return BOOL(1);
    }
    let title = String::from_utf16_lossy(&text_buf[..copied as usize])
        .trim()
        .to_string();

    if title.is_empty() || title == "Program Manager" || title == "Settings" {
        return BOOL(1);
    }

    // Get process name
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    let mut process_name = String::new();
    if pid != 0 {
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut image_buf = vec![0u16; 1024];
            let mut size = image_buf.len() as u32;
            let res = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                PWSTR(image_buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(handle);

            if res.is_ok() && size > 0 {
                let full_path = String::from_utf16_lossy(&image_buf[..size as usize]);
                if let Some(filename) = full_path.split('\\').last() {
                    process_name = filename.to_string();
                } else {
                    process_name = full_path;
                }
            }
        }
    }

    let is_minimized = IsIconic(hwnd).as_bool();

    state.windows.push(CapturableWindow {
        id: format!("{:?}", hwnd.0),
        title,
        process_name,
        is_minimized,
    });

    BOOL(1)
}

#[tauri::command]
pub fn list_capturable_windows() -> Result<Vec<CapturableWindow>, String> {
    let mut state = EnumState {
        windows: Vec::new(),
    };

    unsafe {
        let lparam = LPARAM(&mut state as *mut _ as isize);
        let _ = EnumWindows(Some(enum_windows_proc), lparam);
    }

    Ok(state.windows)
}
