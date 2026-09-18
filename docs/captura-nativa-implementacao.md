# Implementação atual da captura nativa

Este documento registra o estado efetivo após a aplicação do plano de `plano-captura-nativa.md`.

## Entregue

- O Rust enumera janelas e monitores separadamente, incluindo dimensões, DPI, processo e monitor associado.
- A UI recebe `sourceId` opaco; HWND/HMONITOR nunca são enviados pelo WebView.
- A enumeração invalida IDs anteriores e o Rust revalida a existência da janela, a visibilidade e o PID antes de iniciar uma sessão.
- A sessão nativa possui estados `idle`, `starting`, `live`, `stopping` e `error`, comandos idempotentes e eventos Tauri de estado.
- O frontend usa `CaptureManager`, com provedores `browser` e `native`. A chamada a `getDisplayMedia()` ficou isolada no provedor browser.
- Selecionar uma janela/monitor encaminha a fonte selecionada. O fallback para o seletor WebView2 só ocorre pelo botão explícito.
- O estado publicado na sala identifica o provedor e o tipo da fonte sem expor o identificador local.
- O build não encerra mais qualquer `seemygame.exe`: quando solicitado, limita o encerramento a processos cujo executável esteja no `src-tauri/target` do checkout atual.

## Worker de mídia entregue

`src-tauri/src/media.rs` agora implementa o worker de captura/encode com
processo GStreamer sem shell:

- janela: `d3d11screencapturesrc capture-api=wgc window-handle=...`;
- monitor: a mesma fonte com `monitor-handle=...` revalidado pelo Rust;
- vídeo: `d3d11convert` para NV12, `mfh264enc` ou `mfh265enc`, parser e RTP;
- áudio do sistema/processo: `wasapi2src` em loopback, conversão/resampling,
  `opusenc` e RTP;
- endpoints RTP são reservados em `127.0.0.1` e nunca passam pelo JSON IPC;
- trocar o modo de áudio reinicia apenas o worker da sessão; parar a sessão
  encerra o processo GStreamer.

O codec padrão é H.264. HEVC/H.265 pode ser selecionado com
`SEEMYGAME_NATIVE_CODEC=hevc`; bitrate e FPS podem ser ajustados por
`SEEMYGAME_NATIVE_BITRATE_KBPS` e `SEEMYGAME_NATIVE_FPS`. O áudio por processo
é anunciado somente em Windows build 20348 ou superior.

O contrato de capacidades separa `worker_available`, `bridge_available` e
`available`. O último permanece falso até a ponte WebRTC entregar um
`MediaStream` ao WebView, mesmo quando o runtime já estiver instalado.

## Runtime e ponte WebRTC

O checkout de desenvolvimento não contém os binários GStreamer. Execute
`tools/prepare-native-media.ps1` em uma máquina Windows para baixar e colocar o
runtime oficial em `native-media/gstreamer`; depois valide com
`tools/validate-native-media.ps1 -SmokeTest`. O bundle Tauri inclui
`native-media` como recurso.

O worker entrega RTP local ao bridge in-process `webrtcbin` em
`src-tauri/src/webrtc_bridge.rs`. Os comandos Tauri negociam SDP/ICE e o
`js/native-webrtc.js` devolve o `MediaStream` ao WebView. A sinalização de
espectadores remotos ainda precisa ser exercitada em sala real; o fallback do
navegador continua explícito.

Prepare o runtime e o SDK com `npm run native:prepare` e valide os plugins com
`npm run native:smoke`. O build copia as DLLs de carregamento para o diretório
do executável durante o desenvolvimento. No instalador NSIS, o hook em
`src-tauri/windows/hooks.nsh` faz a mesma colocação após os recursos serem
instalados; o restante do runtime permanece em `resources/native-media`.

## Verificações realizadas

- `npm test`: 340 testes aprovados em 30 arquivos.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: aprovado.
- `cargo check --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets`: aprovado.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets -- -D warnings`: aprovado.
- Testes unitários Rust do construtor de pipeline H.264/HEVC e áudio de processo: aprovados.
- `node --check` em `js/app.js`, `js/capture.js` e `js/desktop.js`: aprovado.
- `node tools/build-dist.js`: aprovado.
- `npm run native:smoke`: plugins obrigatórios, H.264 e HEVC aprovados com
  GStreamer 1.28.7.
- `cargo check --manifest-path src-tauri/Cargo.toml --offline`: aprovado com
  os bindings GStreamer/WebRTC.
