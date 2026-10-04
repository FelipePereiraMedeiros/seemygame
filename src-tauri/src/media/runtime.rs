//! runtime; internal to the native media subsystem.
use super::*;

#[derive(Debug, Clone)]
pub struct GStreamerRuntime {
    pub root: PathBuf,
    pub(crate) launch: PathBuf,
    pub(crate) inspect: PathBuf,
}

impl GStreamerRuntime {
    pub fn discover() -> Option<Self> {
        let mut candidates = Vec::new();
        if let Some(value) = env::var_os("SEEMYGAME_GSTREAMER_ROOT") {
            candidates.push(PathBuf::from(value));
        }
        if let Some(value) = env::var_os("GSTREAMER_ROOT_X86_64") {
            candidates.push(PathBuf::from(value));
        }
        if let Ok(exe) = env::current_exe() {
            if let Some(parent) = exe.parent() {
                for ancestor in parent.ancestors().take(7) {
                    candidates.push(ancestor.join("native-media").join("gstreamer"));
                    candidates.push(
                        ancestor
                            .join("resources")
                            .join("native-media")
                            .join("gstreamer"),
                    );
                    candidates.push(
                        ancestor
                            .join("resources")
                            .join("_up_")
                            .join("native-media")
                            .join("gstreamer"),
                    );
                    candidates.push(ancestor.join("_up_").join("native-media").join("gstreamer"));
                    candidates.push(ancestor.join("resources").join("gstreamer"));
                    candidates.push(ancestor.join("gstreamer"));
                }
            }
        }
        candidates.push(PathBuf::from("native-media/gstreamer"));

        candidates.into_iter().find_map(|root| {
            let launch = root.join("bin").join(executable_name("gst-launch-1.0"));
            let inspect = root.join("bin").join(executable_name("gst-inspect-1.0"));
            (launch.is_file() && inspect.is_file()).then_some(Self {
                root,
                launch,
                inspect,
            })
        })
    }

    pub fn probe(&self) -> MediaCapabilities {
        let mut available = Vec::new();
        let mut missing = Vec::new();
        for element in REQUIRED_ELEMENTS {
            if self.inspect_element(element) {
                available.push(element);
            } else {
                missing.push(element.to_string());
            }
        }

        let has = |element: &str| available.contains(&element);
        let h264_available = has("mfh264enc");
        let nvenc_h264_available = self.inspect_element("nvd3d11h264enc");
        let d3d12_available = ["d3d12screencapturesrc", "d3d12convert", "d3d12download"]
            .iter().all(|element| self.inspect_element(element));
        let x264_available = self.inspect_element("x264enc");
        let hevc_available = has("mfh265enc") && self.inspect_element("h265parse") && self.inspect_element("rtph265pay") && self.inspect_element("rtph265depay");
        let av1_available = self.inspect_element("svtav1enc")
            && self.inspect_element("av1parse")
            && self.inspect_element("rtpav1pay");
        let av1_available = av1_available && self.inspect_element("rtpav1depay");
        let video_available = has("d3d11screencapturesrc")
            && has("d3d11convert")
            && (h264_available
                || nvenc_h264_available
                || x264_available
                || hevc_available
                || av1_available);
        let system_audio_available = has("wasapi2src") && has("opusenc");
        let process_audio_available = system_audio_available && process_loopback_supported();
        let webrtc_available = has("webrtcbin");
        let reason = if missing.is_empty() {
            None
        } else {
            Some(format!(
                "Plugins GStreamer ausentes: {}",
                missing.join(", ")
            ))
        };

        MediaCapabilities {
            runtime_available: true,
            video_available,
            system_audio_available,
            process_audio_available,
            h264_available,
            nvenc_h264_available,
            d3d12_available,
            x264_available,
            hevc_available,
            av1_available,
            webrtc_available,
            missing_elements: missing,
            reason,
        }
    }

    /// Makes the packaged runtime visible to in-process GStreamer bindings.
    /// The worker subprocess receives the same variables through
    /// `configure_environment`; the WebRTC bridge needs them in this process.
    pub fn prepare_process_environment(&self) {
        static PREPARED: OnceLock<()> = OnceLock::new();
        PREPARED.get_or_init(|| {
            let bin = self.root.join("bin");
            let lib = self.root.join("lib");
            let plugins = lib.join("gstreamer-1.0");
            std::env::set_var("GST_PLUGIN_PATH_1_0", &plugins);
            std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &plugins);
            let mut path_entries = vec![bin, lib];
            if let Some(existing) = env::var_os("PATH") {
                for p in env::split_paths(&existing) {
                    if !path_entries.contains(&p) {
                        path_entries.push(p);
                    }
                }
            }
            if let Ok(path) = env::join_paths(path_entries) {
                std::env::set_var("PATH", path);
            }
        });
    }

    pub(crate) fn inspect_element(&self, element: &str) -> bool {
        let started = std::time::Instant::now();
        #[cfg(not(test))]
        crate::system::write_debug_log(&format!("[Media probe] {element}: in-process lookup starting"));
        self.prepare_process_environment();
        if gstreamer::init().is_ok() && gstreamer::ElementFactory::find(element).is_some() {
            #[cfg(not(test))]
            crate::system::write_debug_log(&format!("[Media probe] {element}: available ({} ms)", started.elapsed().as_millis()));
            return true;
        }
        #[cfg(not(test))]
        crate::system::write_debug_log(&format!("[Media probe] {element}: external lookup starting"));
        let mut command = Command::new(&self.inspect);
        command
            .arg(element)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_environment(&mut command, &self.root);
        let available = command
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        #[cfg(not(test))]
        crate::system::write_debug_log(&format!("[Media probe] {element}: external available={available} ({} ms)", started.elapsed().as_millis()));
        available
    }

    pub(crate) fn command(&self) -> Command {
        let mut command = Command::new(&self.launch);
        configure_environment(&mut command, &self.root);
        command
    }
}
