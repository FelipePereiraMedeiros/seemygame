use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFO,
    MONITORINFOEXW, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetWindow, GetWindowLongW, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, GA_ROOT,
    GWL_EXSTYLE, GWL_STYLE, GW_OWNER, WS_CHILD, WS_EX_TOOLWINDOW,
};

const DEFAULT_DPI: u32 = 96;

#[derive(Debug, Serialize, Clone)]
pub struct CapturableSource {
    /// Stable only for the current enumeration. It deliberately never contains HWND/HMONITOR.
    pub id: String,
    pub source_id: String,
    /// `window` or `monitor`; these are intentionally not interchangeable.
    pub source_type: String,
    pub title: String,
    pub process_name: String,
    pub process_id: Option<u32>,
    pub monitor_id: Option<String>,
    pub width: u32,
    pub height: u32,
    pub left: i32,
    pub top: i32,
    pub dpi: u32,
    pub is_minimized: bool,
    pub supports_audio: bool,
}

#[derive(Clone)]
enum SourceKind {
    Window,
    Monitor,
}

#[derive(Clone)]
struct SourceRecord {
    source_id: String,
    kind: SourceKind,
    title: String,
    hwnd: Option<isize>,
    monitor_id: Option<String>,
    process_id: Option<u32>,
}

#[allow(dead_code)]
#[derive(Clone)]
pub struct ValidatedSource {
    pub source_id: String,
    pub source_type: String,
    pub title: String,
    pub process_id: Option<u32>,
    pub hwnd: Option<isize>,
    pub monitor_id: Option<String>,
    pub monitor_handle: Option<isize>,
    pub width: u32,
    pub height: u32,
    pub dpi: u32,
    pub left: i32,
    pub top: i32,
}

struct SourceRegistry {
    sources: HashMap<String, SourceRecord>,
}

static SOURCE_REGISTRY: OnceLock<Mutex<SourceRegistry>> = OnceLock::new();
static SOURCE_GENERATION: AtomicU64 = AtomicU64::new(1);

fn source_registry() -> &'static Mutex<SourceRegistry> {
    SOURCE_REGISTRY.get_or_init(|| {
        Mutex::new(SourceRegistry {
            sources: HashMap::new(),
        })
    })
}

struct WindowCandidate {
    hwnd: HWND,
    title: String,
    process_name: String,
    process_id: Option<u32>,
    monitor_id: Option<String>,
    width: u32,
    height: u32,
    left: i32,
    top: i32,
    dpi: u32,
    is_minimized: bool,
}

struct MonitorCandidate {
    monitor_id: String,
    handle: HMONITOR,
    width: u32,
    height: u32,
    left: i32,
    top: i32,
    dpi: u32,
}

struct WindowEnumState {
    windows: Vec<WindowCandidate>,
}

struct MonitorEnumState {
    monitors: Vec<MonitorCandidate>,
}

fn process_name(pid: u32) -> String {
    if pid == 0 {
        return String::new();
    }

    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };

        let mut image_buf = vec![0u16; 1024];
        let mut size = image_buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(image_buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);

        if result.is_err() || size == 0 {
            return String::new();
        }

        let full_path = String::from_utf16_lossy(&image_buf[..size as usize]);
        full_path
            .rsplit('\\')
            .next()
            .unwrap_or(&full_path)
            .to_string()
    }
}

fn monitor_id_for_window(hwnd: HWND) -> Option<String> {
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.0.is_null() {
            return None;
        }
        monitor_device_name(monitor)
    }
}

unsafe fn monitor_device_name(monitor: HMONITOR) -> Option<String> {
    let mut info: MONITORINFOEXW = std::mem::zeroed();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if !GetMonitorInfoW(monitor, &mut info.monitorInfo).as_bool() {
        return None;
    }

    let end = info
        .szDevice
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(info.szDevice.len());
    Some(String::from_utf16_lossy(&info.szDevice[..end]))
}

unsafe fn monitor_dpi(monitor: HMONITOR) -> u32 {
    let mut dpi_x = DEFAULT_DPI;
    let mut dpi_y = DEFAULT_DPI;
    if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y).is_ok() {
        return dpi_x.max(DEFAULT_DPI);
    }
    DEFAULT_DPI
}

unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut WindowEnumState);

    if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
        return BOOL(1);
    }

    let mut cloaked: u32 = 0;
    let cloaked_result = DwmGetWindowAttribute(
        hwnd,
        DWMWA_CLOAKED,
        &mut cloaked as *mut _ as *mut _,
        std::mem::size_of::<u32>() as u32,
    );
    if cloaked_result.is_ok() && cloaked != 0 {
        return BOOL(1);
    }

    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
    if (ex_style & WS_EX_TOOLWINDOW.0 as i32) != 0 {
        return BOOL(1);
    }

    let length = GetWindowTextLengthW(hwnd);
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

    let style = GetWindowLongW(hwnd, GWL_STYLE);
    if (style & (WS_CHILD.0 as i32)) != 0 {
        return BOOL(1);
    }

    let root = GetAncestor(hwnd, GA_ROOT);
    if root != hwnd {
        return BOOL(1);
    }

    if let Ok(owner) = GetWindow(hwnd, GW_OWNER) {
        if !owner.0.is_null() {
            return BOOL(1);
        }
    }

    let mut rect = RECT::default();
    let _ = GetWindowRect(hwnd, &mut rect);
    let width = (rect.right - rect.left).max(0) as u32;
    let height = (rect.bottom - rect.top).max(0) as u32;
    if width <= 32 || height <= 32 {
        return BOOL(1);
    }

    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    state.windows.push(WindowCandidate {
        hwnd,
        title,
        process_name: process_name(pid),
        process_id: (pid != 0).then_some(pid),
        monitor_id: monitor_id_for_window(hwnd),
        width,
        height,
        left: rect.left,
        top: rect.top,
        dpi: GetDpiForWindow(hwnd).max(DEFAULT_DPI),
        is_minimized: IsIconic(hwnd).as_bool(),
    });

    BOOL(1)
}

unsafe extern "system" fn enum_monitors_proc(
    monitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let state = &mut *(lparam.0 as *mut MonitorEnumState);
    let Some(monitor_id) = monitor_device_name(monitor) else {
        return BOOL(1);
    };

    let mut info: MONITORINFO = std::mem::zeroed();
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if !GetMonitorInfoW(monitor, &mut info).as_bool() {
        return BOOL(1);
    }

    state.monitors.push(MonitorCandidate {
        monitor_id,
        handle: monitor,
        width: (info.rcMonitor.right - info.rcMonitor.left).max(0) as u32,
        height: (info.rcMonitor.bottom - info.rcMonitor.top).max(0) as u32,
        left: info.rcMonitor.left,
        top: info.rcMonitor.top,
        dpi: monitor_dpi(monitor),
    });

    BOOL(1)
}

fn enumerate_candidates() -> (Vec<WindowCandidate>, Vec<MonitorCandidate>) {
    let mut window_state = WindowEnumState {
        windows: Vec::new(),
    };
    let mut monitor_state = MonitorEnumState {
        monitors: Vec::new(),
    };

    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_proc),
            LPARAM(&mut window_state as *mut _ as isize),
        );
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(enum_monitors_proc),
            LPARAM(&mut monitor_state as *mut _ as isize),
        );
    }

    (window_state.windows, monitor_state.monitors)
}

pub(crate) fn enumerate_sources() -> Vec<CapturableSource> {
    let generation = SOURCE_GENERATION.fetch_add(1, Ordering::Relaxed);
    let (windows, monitors) = enumerate_candidates();
    let mut public_sources = Vec::with_capacity(windows.len() + monitors.len());
    let mut records = HashMap::new();
    let mut index = 0usize;

    for candidate in windows {
        let source_id = format!("capture_{}_window_{}", generation, index);
        index += 1;
        let title = candidate.title;
        let source = CapturableSource {
            id: source_id.clone(),
            source_id: source_id.clone(),
            source_type: "window".to_string(),
            title: title.clone(),
            process_name: candidate.process_name.clone(),
            process_id: candidate.process_id,
            monitor_id: candidate.monitor_id.clone(),
            width: candidate.width,
            height: candidate.height,
            left: candidate.left,
            top: candidate.top,
            dpi: candidate.dpi,
            is_minimized: candidate.is_minimized,
            supports_audio: candidate.process_id.is_some(),
        };
        records.insert(
            source_id.clone(),
            SourceRecord {
                source_id: source_id.clone(),
                kind: SourceKind::Window,
                title,
                hwnd: Some(candidate.hwnd.0 as isize),
                monitor_id: candidate.monitor_id,
                process_id: candidate.process_id,
            },
        );
        #[cfg(not(test))]
        crate::system::write_debug_log(&format!(
            "[Capture Window Candidate] source_id={}, hwnd={:?} (0x{:X}), pid={:?}, process='{}', title='{}', size={}x{}",
            source_id,
            candidate.hwnd.0,
            candidate.hwnd.0 as u64,
            candidate.process_id,
            candidate.process_name,
            source.title,
            candidate.width,
            candidate.height,
        ));
        public_sources.push(source);
    }

    for candidate in monitors {
        let source_id = format!("capture_{}_monitor_{}", generation, index);
        index += 1;
        let source = CapturableSource {
            id: source_id.clone(),
            source_id: source_id.clone(),
            source_type: "monitor".to_string(),
            title: format!("Monitor {}", candidate.monitor_id.replace("\\\\.\\", "")),
            process_name: String::new(),
            process_id: None,
            monitor_id: Some(candidate.monitor_id.clone()),
            width: candidate.width,
            height: candidate.height,
            left: candidate.left,
            top: candidate.top,
            dpi: candidate.dpi,
            is_minimized: false,
            supports_audio: true,
        };
        records.insert(
            source_id.clone(),
            SourceRecord {
                source_id,
                kind: SourceKind::Monitor,
                title: String::new(),
                hwnd: None,
                monitor_id: Some(candidate.monitor_id),
                process_id: None,
            },
        );
        public_sources.push(source);
    }

    if let Ok(mut registry) = source_registry().lock() {
        if registry.sources.len() > 300 {
            registry.sources.clear();
        }
        registry.sources.extend(records);
    }

    public_sources
}

#[cfg(not(test))]
#[tauri::command]
pub fn list_capture_sources() -> Result<Vec<CapturableSource>, String> {
    Ok(enumerate_sources())
}

/// Compatibility command for older UI builds. New code should use list_capture_sources.
#[cfg(not(test))]
#[tauri::command]
pub fn list_capturable_windows() -> Result<Vec<CapturableSource>, String> {
    Ok(enumerate_sources()
        .into_iter()
        .filter(|source| source.source_type == "window")
        .collect())
}

fn source_kind_name(kind: &SourceKind) -> &'static str {
    match kind {
        SourceKind::Window => "window",
        SourceKind::Monitor => "monitor",
    }
}

unsafe fn validate_window(record: &SourceRecord) -> Result<(i32, i32, u32, u32, u32), String> {
    let hwnd_value = record
        .hwnd
        .ok_or_else(|| "Fonte de janela sem HWND".to_string())?;
    let hwnd = HWND(hwnd_value as *mut std::ffi::c_void);
    if !IsWindow(Some(hwnd)).as_bool() || !IsWindowVisible(hwnd).as_bool() {
        return Err("A janela selecionada não está mais disponível".to_string());
    }
    if IsIconic(hwnd).as_bool() {
        return Err("A janela selecionada está minimizada".to_string());
    }

    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if record.process_id != (pid != 0).then_some(pid) {
        return Err(
            "A identidade do processo da janela mudou; selecione a fonte novamente".to_string(),
        );
    }

    let mut rect = RECT::default();
    let _ = GetWindowRect(hwnd, &mut rect);
    Ok((
        rect.left,
        rect.top,
        (rect.right - rect.left).max(0) as u32,
        (rect.bottom - rect.top).max(0) as u32,
        GetDpiForWindow(hwnd).max(DEFAULT_DPI),
    ))
}

unsafe fn validate_monitor(
    record: &SourceRecord,
) -> Result<(isize, i32, i32, u32, u32, u32), String> {
    let wanted = record
        .monitor_id
        .as_deref()
        .ok_or_else(|| "Fonte de monitor sem identificação".to_string())?;
    let mut state = MonitorEnumState {
        monitors: Vec::new(),
    };
    let _ = EnumDisplayMonitors(
        None,
        None,
        Some(enum_monitors_proc),
        LPARAM(&mut state as *mut _ as isize),
    );
    let Some(monitor) = state.monitors.into_iter().find(|m| m.monitor_id == wanted) else {
        return Err("O monitor selecionado não está mais disponível".to_string());
    };
    Ok((
        monitor.handle.0 as isize,
        monitor.left,
        monitor.top,
        monitor.width,
        monitor.height,
        monitor.dpi,
    ))
}

/// Resolves and revalidates the opaque ID immediately before a capture starts.
/// The caller receives identity data, never an untrusted raw HWND/HMONITOR from JS.
pub fn resolve_capture_source(source_id: &str) -> Result<ValidatedSource, String> {
    let record = source_registry()
        .lock()
        .map_err(|_| "Registro de fontes indisponível".to_string())?
        .sources
        .get(source_id)
        .cloned()
        .ok_or_else(|| "sourceId expirado; atualize a lista de fontes".to_string())?;

    let (monitor_handle, left, top, width, height, dpi) = unsafe {
        match record.kind {
            SourceKind::Window => {
                let (left, top, width, height, dpi) = validate_window(&record)?;
                (0, left, top, width, height, dpi)
            }
            SourceKind::Monitor => validate_monitor(&record)?,
        }
    };

    Ok(ValidatedSource {
        source_id: record.source_id,
        source_type: source_kind_name(&record.kind).to_string(),
        title: record.title,
        process_id: record.process_id,
        hwnd: record.hwnd,
        monitor_id: record.monitor_id,
        monitor_handle: (monitor_handle != 0).then_some(monitor_handle),
        width,
        height,
        dpi,
        left,
        top,
    })
}
