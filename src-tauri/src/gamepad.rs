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

#[cfg(windows)]
mod native {
    use super::*;
    use vigem_client::{Client, TargetId, XButtons, XGamepad, Xbox360Wired};

    pub struct NativeGamepadManager {
        client: Option<Arc<Client>>,
        targets: HashMap<u8, Xbox360Wired<Arc<Client>>>,
    }

    impl NativeGamepadManager {
        pub fn new() -> Self {
            let client = Client::connect().ok().map(Arc::new);
            if client.is_some() {
                log::info!("[Gamepad] ViGEmBus driver conectado com sucesso!");
            } else {
                log::warn!("[Gamepad] ViGEmBus driver não disponível ou serviço parado.");
            }
            Self {
                client,
                targets: HashMap::new(),
            }
        }

        pub fn is_available(&mut self) -> bool {
            if self.client.is_none() {
                self.client = Client::connect().ok().map(Arc::new);
            }
            self.client.is_some()
        }

        pub fn plug(&mut self, slot: u8) -> Result<(), String> {
            if self.targets.contains_key(&slot) {
                return Ok(()); // Já conectado
            }
            let client = self
                .client
                .as_ref()
                .ok_or_else(|| "Driver ViGEmBus não está conectado".to_string())?
                .clone();

            let mut target: Xbox360Wired<Arc<Client>> =
                Xbox360Wired::new(client, TargetId::XBOX360_WIRED);
            target
                .plugin()
                .map_err(|e| format!("Falha ao plugar controle virtual: {:?}", e))?;
            let _ = target.wait_ready();
            log::info!(
                "[Gamepad] Controle virtual Xbox 360 plugado com sucesso no Slot {}",
                slot
            );
            self.targets.insert(slot, target);
            Ok(())
        }

        pub fn update(&mut self, slot: u8, report: &GamepadReport) -> Result<(), String> {
            let target = self
                .targets
                .get_mut(&slot)
                .ok_or_else(|| format!("Nenhum controle virtual ativo no Slot {}", slot))?;

            let xgamepad = convert_report_to_xgamepad(report);
            target
                .update(&xgamepad)
                .map_err(|e| format!("Falha ao enviar relatório para controle: {:?}", e))?;
            Ok(())
        }

        pub fn unplug(&mut self, slot: u8) -> Result<(), String> {
            if let Some(target) = self.targets.remove(&slot) {
                // Drop do target desconecta o dispositivo do ViGEmBus
                drop(target);
                log::info!("[Gamepad] Controle virtual no Slot {} desconectado.", slot);
            }
            Ok(())
        }

        pub fn unplug_all(&mut self) -> Result<(), String> {
            let count = self.targets.len();
            self.targets.clear();
            if count > 0 {
                log::info!(
                    "[Gamepad] Todos os {} controles virtuais foram desconectados.",
                    count
                );
            }
            Ok(())
        }

        pub fn active_slots(&self) -> Vec<u8> {
            let mut slots: Vec<u8> = self.targets.keys().copied().collect();
            slots.sort();
            slots
        }
    }

    pub fn convert_report_to_xgamepad(report: &GamepadReport) -> XGamepad {
        let mut buttons_mask = 0u16;

        // Mapeamento W3C Standard Gamepad para constantes XInput
        // 0: A (0x1000)
        // 1: B (0x2000)
        // 2: X (0x4000)
        // 3: Y (0x8000)
        // 4: LB (0x0100)
        // 5: RB (0x0200)
        // 8: Back (0x0020)
        // 9: Start (0x0010)
        // 10: LS (0x0040)
        // 11: RS (0x0080)
        // 12: D-Up (0x0001)
        // 13: D-Down (0x0002)
        // 14: D-Left (0x0004)
        // 15: D-Right (0x0008)
        let get_btn = |idx: usize| -> bool { report.buttons.get(idx).copied().unwrap_or(false) };

        if get_btn(0) {
            buttons_mask |= 0x1000;
        } // A
        if get_btn(1) {
            buttons_mask |= 0x2000;
        } // B
        if get_btn(2) {
            buttons_mask |= 0x4000;
        } // X
        if get_btn(3) {
            buttons_mask |= 0x8000;
        } // Y
        if get_btn(4) {
            buttons_mask |= 0x0100;
        } // LB
        if get_btn(5) {
            buttons_mask |= 0x0200;
        } // RB
        if get_btn(8) {
            buttons_mask |= 0x0020;
        } // Back
        if get_btn(9) {
            buttons_mask |= 0x0010;
        } // Start
        if get_btn(10) {
            buttons_mask |= 0x0040;
        } // Left Thumb (LS)
        if get_btn(11) {
            buttons_mask |= 0x0080;
        } // Right Thumb (RS)
        if get_btn(12) {
            buttons_mask |= 0x0001;
        } // D-Pad Up
        if get_btn(13) {
            buttons_mask |= 0x0002;
        } // D-Pad Down
        if get_btn(14) {
            buttons_mask |= 0x0004;
        } // D-Pad Left
        if get_btn(15) {
            buttons_mask |= 0x0008;
        } // D-Pad Right

        // Gatilhos analógicos: 0 a 255
        let left_trigger = if let Some(trigs) = &report.triggers {
            (trigs.first().copied().unwrap_or(0.0).clamp(0.0, 1.0) * 255.0) as u8
        } else if get_btn(6) {
            255
        } else {
            0
        };

        let right_trigger = if let Some(trigs) = &report.triggers {
            (trigs.get(1).copied().unwrap_or(0.0).clamp(0.0, 1.0) * 255.0) as u8
        } else if get_btn(7) {
            255
        } else {
            0
        };

        // Eixos analógicos: -32768 a 32767
        // Nota crítica: no Web Gamepad API, Y negativo é CIMA (-1.0 = Up).
        // No DirectX/XInput, Y positivo é CIMA (+32767 = Up).
        // Portanto, thumb_ly = -axis_y * 32767.0!
        let get_axis = |idx: usize| -> f32 {
            report
                .axes
                .get(idx)
                .copied()
                .unwrap_or(0.0)
                .clamp(-1.0, 1.0)
        };

        let thumb_lx = (get_axis(0) * 32767.0) as i16;
        let thumb_ly = (-get_axis(1) * 32767.0) as i16;
        let thumb_rx = (get_axis(2) * 32767.0) as i16;
        let thumb_ry = (-get_axis(3) * 32767.0) as i16;

        XGamepad {
            buttons: XButtons { raw: buttons_mask },
            left_trigger,
            right_trigger,
            thumb_lx,
            thumb_ly,
            thumb_rx,
            thumb_ry,
        }
    }
}

// Fallback não-Windows / stub
#[cfg(not(windows))]
mod native {
    use super::*;

    pub struct NativeGamepadManager;
    impl NativeGamepadManager {
        pub fn new() -> Self {
            Self
        }
        pub fn is_available(&mut self) -> bool {
            false
        }
        pub fn plug(&mut self, _slot: u8) -> Result<(), String> {
            Err("ViGEmBus é suportado apenas no Windows".into())
        }
        pub fn update(&mut self, _slot: u8, _report: &GamepadReport) -> Result<(), String> {
            Err("ViGEmBus é suportado apenas no Windows".into())
        }
        pub fn unplug(&mut self, _slot: u8) -> Result<(), String> {
            Ok(())
        }
        pub fn unplug_all(&mut self) -> Result<(), String> {
            Ok(())
        }
        pub fn active_slots(&self) -> Vec<u8> {
            Vec::new()
        }
    }
}

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
pub async fn install_vigem_driver() -> Result<String, String> {
    #[cfg(windows)]
    {
        let mut script_path = None;
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let candidates = [
                    parent.join("tools").join("install-vigem.ps1"),
                    parent.join("resources").join("tools").join("install-vigem.ps1"),
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

        log::info!("[Gamepad] Invocando instalador do ViGEmBus com elevação: {}", script.display());

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
