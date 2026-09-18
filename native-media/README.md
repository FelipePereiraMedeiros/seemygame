# Native media runtime

This directory is the package location for the pinned Windows GStreamer
runtime used by the SeeMyGame native capture worker. The binaries are not
checked into the repository. Run the following from the repository root on a
Windows build machine:

```powershell
.\tools\prepare-native-media.ps1
.\tools\validate-native-media.ps1 -SmokeTest
```

Para preparar também o SDK necessário à compilação Rust, use:

```powershell
npm run native:prepare
```

The preparation script downloads the official MSVC x86_64 runtime and installs
it below `native-media/gstreamer`. The Tauri bundle includes this directory as
a resource, and the Rust worker searches the bundled resource path before
falling back to the development checkout.

Provision the runtime and Rust SDK before compiling the desktop application;
the Tauri build hooks intentionally do not download dependencies. `npm run desktop`
performs this provisioning explicitly, while CI or packaging should run
`npm run native:prepare` as a separate setup step before `npm run tauri:build`.

The native worker exposes encoded H.264/HEVC and Opus RTP endpoints to the
in-process `webrtcbin` bridge in `src-tauri/src/webrtc_bridge.rs`. The bridge
negotiates SDP/ICE with the WebView and returns a browser `MediaStream`; media
bytes never pass through Tauri JSON IPC. The NSIS hook places the loader DLLs
beside the application executable while the complete runtime remains under
the bundled resources directory.

Do not copy a system-wide GStreamer install into this folder; use the pinned
preparation script so validation and packaging remain reproducible.
