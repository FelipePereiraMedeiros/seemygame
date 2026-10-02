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
