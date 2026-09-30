//! environment; internal to the native media subsystem.
use super::*;

pub(crate) fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

pub(crate) fn configure_environment(command: &mut Command, root: &Path) {
    let bin = root.join("bin");
    let lib = root.join("lib");
    let plugins = lib.join("gstreamer-1.0");
    command
        .current_dir(root)
        .env("GST_PLUGIN_PATH_1_0", &plugins)
        .env("GST_PLUGIN_SYSTEM_PATH_1_0", &plugins);
    command.env("GST_DEBUG_NO_COLOR", "1");
    if let Ok(debug) = env::var("GST_DEBUG") {
        command.env("GST_DEBUG", debug);
    } else {
        command.env("GST_DEBUG", "*:2,webrtc*:3");
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW | HIGH_PRIORITY_CLASS);
    let mut path_entries = vec![bin, lib];
    if let Some(existing) = env::var_os("PATH") {
        for p in env::split_paths(&existing) {
            if !path_entries.contains(&p) {
                path_entries.push(p);
            }
        }
    }
    if let Ok(path) = env::join_paths(path_entries) {
        command.env("PATH", path);
    }
}
