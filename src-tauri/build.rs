use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();
    println!("cargo:rerun-if-changed=../native-media/gstreamer/manifest.json");
    println!("cargo:rerun-if-changed=../native-media/gstreamer/bin");

    copy_runtime_dlls_to_profile_dir();
}

fn copy_runtime_dlls_to_profile_dir() {
    let manifest_dir =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let runtime_bin = manifest_dir
        .join("..")
        .join("native-media")
        .join("gstreamer")
        .join("bin");
    if !runtime_bin.is_dir() {
        println!("cargo:warning=GStreamer runtime não preparado; execute npm run native:prepare");
        return;
    }

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let Some(profile_dir) = out_dir.ancestors().nth(3).map(Path::to_path_buf) else {
        println!("cargo:warning=Não foi possível determinar o diretório do perfil Cargo");
        return;
    };

    let mut copied = 0usize;
    let Ok(entries) = fs::read_dir(&runtime_bin) else {
        println!(
            "cargo:warning=Não foi possível ler {}",
            runtime_bin.display()
        );
        return;
    };
    for entry in entries.flatten() {
        let source = entry.path();
        if source.extension().and_then(|value| value.to_str()) != Some("dll") {
            continue;
        }
        let destination = profile_dir.join(entry.file_name());
        match fs::copy(&source, &destination) {
            Ok(_) => copied += 1,
            Err(error) => println!(
                "cargo:warning=Falha ao copiar {}: {}",
                source.display(),
                error
            ),
        }
    }
    println!(
        "cargo:warning={} DLLs GStreamer disponíveis em {}",
        copied,
        profile_dir.display()
    );
}
