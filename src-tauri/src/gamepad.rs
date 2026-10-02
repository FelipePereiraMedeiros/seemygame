use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GamepadReport {
    /// 17 botões do padrão W3C Gamepad API
    #[serde(default)]
    pub buttons: Vec<bool>,
    /// Gatilhos analógicos opcionais [left (0.0..1.0), right (0.0..1.0)]
    #[serde(default)]
    pub triggers: Option<Vec<f32>>,
    /// Eixos analógicos [lx, ly, rx, ry] (-1.0..1.0)
    #[serde(default)]
    pub axes: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GamepadStatus {
    pub vigem_available: bool,
    pub active_slots: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct XInputButtonSnapshot {
    pub pressed: bool,
    pub value: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct XInputGamepadSnapshot {
    pub index: u32,
    pub id: String,
    pub connected: bool,
    pub buttons: Vec<XInputButtonSnapshot>,
    pub axes: Vec<f32>,
}

#[cfg(windows)]
#[path = "gamepad/windows.rs"]
mod native;

// Fallback não-Windows / stub
#[cfg(not(windows))]
#[path = "gamepad/fallback.rs"]
mod native;

static GAMEPAD_MANAGER: Mutex<Option<native::NativeGamepadManager>> = Mutex::new(None);

fn with_manager<F, R>(f: F) -> R
where
    F: FnOnce(&mut native::NativeGamepadManager) -> R,
{
    let mut lock = GAMEPAD_MANAGER.lock().unwrap();
    if lock.is_none() {
        *lock = Some(native::NativeGamepadManager::new());
    }
    f(lock.as_mut().unwrap())
}

#[tauri::command]
pub fn check_gamepad_driver_status() -> GamepadStatus {
    with_manager(|mgr| GamepadStatus {
        vigem_available: mgr.is_available(),
        active_slots: mgr.active_slots(),
    })
}

#[tauri::command]
pub fn plug_virtual_gamepad(slot: u8) -> Result<(), String> {
    with_manager(|mgr| mgr.plug(slot))
}

#[tauri::command]
pub fn update_virtual_gamepad(slot: u8, report: GamepadReport) -> Result<(), String> {
    with_manager(|mgr| mgr.update(slot, &report))
}

#[tauri::command]
pub fn unplug_virtual_gamepad(slot: u8) -> Result<(), String> {
    with_manager(|mgr| mgr.unplug(slot))
}

#[tauri::command]
pub fn unplug_all_virtual_gamepads() -> Result<(), String> {
    with_manager(|mgr| mgr.unplug_all())
}

#[tauri::command]
pub fn get_xinput_gamepads() -> Vec<XInputGamepadSnapshot> {
    #[cfg(windows)]
    {
        native::connected_xinput_gamepads()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[tauri::command]
pub fn test_gamepad_vibration(
    gamepad_index: u32,
    strong_magnitude: f64,
    weak_magnitude: f64,
    duration_ms: u64,
) -> Result<(), String> {
    if gamepad_index > 3 {
        return Err("O índice do controle deve estar entre 0 e 3 no Windows.".to_string());
    }
    if !strong_magnitude.is_finite()
        || !weak_magnitude.is_finite()
        || !(0.0..=1.0).contains(&strong_magnitude)
        || !(0.0..=1.0).contains(&weak_magnitude)
    {
        return Err("A intensidade da vibração deve estar entre 0 e 1.".to_string());
    }
    if duration_ms == 0 || duration_ms > 2_000 {
        return Err("A duração da vibração deve estar entre 1 e 2000 ms.".to_string());
    }

    #[cfg(windows)]
    {
        native::test_vibration(
            gamepad_index,
            strong_magnitude as f32,
            weak_magnitude as f32,
            duration_ms,
        )
    }
    #[cfg(not(windows))]
    {
        let _ = (gamepad_index, strong_magnitude, weak_magnitude, duration_ms);
        Err("A vibração nativa só está disponível no Windows.".to_string())
    }
}

#[tauri::command]
pub async fn install_vigem_driver() -> Result<String, String> {
    #[cfg(windows)]
    {
        let mut script_path = None;
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let candidates = [
                    parent.join("tools").join("install-vigem.ps1"),
                    parent
                        .join("resources")
                        .join("tools")
                        .join("install-vigem.ps1"),
                    parent.join("resources").join("install-vigem.ps1"),
                ];
                for cand in candidates {
                    if cand.exists() {
                        script_path = Some(cand);
                        break;
                    }
                }
                if script_path.is_none() {
                    for ancestor in parent.ancestors().take(7) {
                        let candidate = ancestor.join("tools").join("install-vigem.ps1");
                        if candidate.exists() {
                            script_path = Some(candidate);
                            break;
                        }
                    }
                }
            }
        }

        let script = script_path.ok_or_else(|| {
            "Script de instalação tools/install-vigem.ps1 não encontrado".to_string()
        })?;

        log::info!(
            "[Gamepad] Invocando instalador do ViGEmBus com elevação: {}",
            script.display()
        );

        let ps_cmd = format!(
            "Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"{}\"' -Verb RunAs -Wait",
            script.display()
        );

        let status = std::process::Command::new("powershell.exe")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(&ps_cmd)
            .status()
            .map_err(|e| format!("Falha ao invocar processo de instalação: {e}"))?;

        if !status.success() {
            return Err("A instalação do driver foi cancelada ou falhou".to_string());
        }

        let mut lock = GAMEPAD_MANAGER.lock().unwrap();
        *lock = Some(native::NativeGamepadManager::new());
        if let Some(mgr) = lock.as_mut() {
            if mgr.is_available() {
                return Ok("Driver ViGEmBus instalado e conectado com sucesso!".to_string());
            }
        }

        Ok("Instalação concluída. Verifique se o serviço ViGEmBus está ativo.".to_string())
    }
    #[cfg(not(windows))]
    {
        Err("ViGEmBus é suportado apenas no Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gamepad_report_defaults() {
        let json = r#"{"buttons": [true, false], "axes": [0.5, -0.5]}"#;
        let report: GamepadReport = serde_json::from_str(json).expect("should parse");
        assert_eq!(report.buttons.len(), 2);
        assert!(report.buttons[0]);
        assert!(!report.buttons[1]);
        assert_eq!(report.axes.len(), 2);
        assert_eq!(report.axes[0], 0.5);
        assert_eq!(report.axes[1], -0.5);
        assert!(report.triggers.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn maps_w3c_buttons_and_inverts_y_axis() {
        let mut buttons = vec![false; 17];
        buttons[0] = true; // A
        buttons[12] = true; // D-Pad Up
        let triggers = Some(vec![0.75, 1.0]);
        let axes = vec![0.5, 0.8, -0.2, -1.0]; // Ly = 0.8 (Down), Ry = -1.0 (Up)

        let report = GamepadReport {
            buttons,
            triggers,
            axes,
        };

        let xgp = native::convert_report_to_xgamepad(&report);
        // A (0x1000) | D-Pad Up (0x0001) = 0x1001
        assert_eq!(xgp.buttons.raw, 0x1001);
        // Triggers 0.75 * 255 = 191, 1.0 * 255 = 255
        assert_eq!(xgp.left_trigger, (0.75 * 255.0) as u8);
        assert_eq!(xgp.right_trigger, 255);
        // Sticks:
        assert_eq!(xgp.thumb_lx, (0.5 * 32767.0) as i16);
        // Ly was 0.8 in Web (downwards), must be negative in XInput:
        assert_eq!(xgp.thumb_ly, (-0.8 * 32767.0) as i16);
        assert_eq!(xgp.thumb_rx, (-0.2 * 32767.0) as i16);
        // Ry was -1.0 in Web (upwards), must be positive 32767 in XInput:
        assert_eq!(xgp.thumb_ry, (1.0 * 32767.0) as i16);
    }
}
