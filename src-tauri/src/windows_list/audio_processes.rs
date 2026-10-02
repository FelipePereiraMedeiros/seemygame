//! audio processes; internal to the native windows_list subsystem.
use super::*;

#[derive(Debug, Serialize, Clone)]
pub struct AudioExclusionCandidate {
    pub id: String,
    pub label: String,
    pub process_name: String,
    pub process_id: Option<u32>,
    pub is_running: bool,
}

pub fn find_process_id_by_name(target: &str) -> Option<u32> {
    let lower = target.trim().to_ascii_lowercase();
    if lower.is_empty() || lower == "none" {
        return None;
    }

    if lower == "self" || lower == "seemygame" || lower == "seemygame.exe" {
        return Some(std::process::id());
    }

    if let Ok(pid) = lower.parse::<u32>() {
        return Some(pid);
    }

    // Procura primeiro nas janelas ativas
    let sources = enumerate_sources();
    for w in &sources {
        if w.source_type != "window" {
            continue;
        }
        let p_name = w.process_name.to_ascii_lowercase();
        if (lower == "discord" && p_name.starts_with("discord"))
            || p_name == lower
            || p_name.starts_with(&lower)
        {
            if let Some(pid) = w.process_id {
                return Some(pid);
            }
        }
    }

    // Busca via EnumProcesses para processos em segundo plano / bandeja (ex: Discord minimizado)
    #[cfg(windows)]
    {
        use windows::Win32::System::ProcessStatus::EnumProcesses;
        let mut pids = vec![0u32; 1024];
        let mut bytes_returned = 0u32;
        unsafe {
            if EnumProcesses(
                pids.as_mut_ptr(),
                (pids.len() * std::mem::size_of::<u32>()) as u32,
                &mut bytes_returned,
            )
            .is_ok()
            {
                let count = (bytes_returned as usize) / std::mem::size_of::<u32>();
                for &pid in &pids[..count] {
                    if pid == 0 {
                        continue;
                    }
                    let name = process_name(pid).to_ascii_lowercase();
                    if (lower == "discord" && name.starts_with("discord"))
                        || name == lower
                        || name.starts_with(&lower)
                    {
                        return Some(pid);
                    }
                }
            }
        }
    }

    None
}

pub fn get_audio_exclusion_candidates() -> Vec<AudioExclusionCandidate> {
    let mut candidates = Vec::new();

    // 1. O próprio SeeMyGame (recomendado)
    let my_pid = std::process::id();
    candidates.push(AudioExclusionCandidate {
        id: "seemygame".to_string(),
        label: "🎮 SeeMyGame (Ignorar Voz da Sala / Recomendado)".to_string(),
        process_name: "seemygame.exe".to_string(),
        process_id: Some(my_pid),
        is_running: true,
    });

    // 2. Discord (detecta se está rodando)
    let discord_pid = find_process_id_by_name("discord");
    let discord_running = discord_pid.is_some();
    let discord_label = if discord_running {
        "🎧 Discord (Ignorar Chamada de Voz Externa)".to_string()
    } else {
        "🎧 Discord (Não detectado no momento)".to_string()
    };
    candidates.push(AudioExclusionCandidate {
        id: "discord".to_string(),
        label: discord_label,
        process_name: "Discord.exe".to_string(),
        process_id: discord_pid,
        is_running: discord_running,
    });

    // 3. Outros aplicativos relevantes com janelas abertas
    let mut seen_pids = std::collections::HashSet::new();
    seen_pids.insert(my_pid);
    if let Some(dpid) = discord_pid {
        seen_pids.insert(dpid);
    }

    let sources = enumerate_sources();
    for w in sources {
        if w.source_type != "window" {
            continue;
        }
        if let Some(pid) = w.process_id {
            if seen_pids.insert(pid) && !w.process_name.is_empty() {
                let lower = w.process_name.to_ascii_lowercase();
                if lower == "explorer.exe" || lower == "dwm.exe" || lower == "taskmgr.exe" {
                    continue;
                }
                candidates.push(AudioExclusionCandidate {
                    id: format!("pid:{pid}"),
                    label: format!("📱 {} ({})", w.process_name, w.title),
                    process_name: w.process_name,
                    process_id: Some(pid),
                    is_running: true,
                });
            }
        }
    }

    candidates
}
