# Ponte WebRTC nativa

O worker de mídia em `src-tauri/src/media.rs` captura e codifica no Windows e
termina em RTP local. `src-tauri/src/webrtc_bridge.rs` consome esses endpoints
com GStreamer `webrtcbin`, negocia SDP/ICE com o WebView e entrega um
`MediaStream` ao frontend. Endpoints RTP e quadros não são enviados por Tauri
JSON IPC.

O fluxo implementado para o primeiro espectador local é:

1. o host inicia uma sessão com `session_id`, `source_id`, codec e modo de
   áudio;
2. o comando Tauri cria uma instância `webrtcbin` e associa as entradas RTP;
3. a oferta/resposta SDP e os candidatos ICE são mensagens direcionadas,
   versionadas e vinculadas a `session_id`, `stream_id` e `peer_id`;
4. o WebView cria uma `RTCPeerConnection` recvonly e recebe a `MediaStream`;
5. parar, perder autorização ou falha do worker destrói a
   instância correspondente e ignora mensagens atrasadas.

## Critérios de aceite da ponte

- uma conexão `RTCPeerConnection` por espectador autorizado (a integração
  atual entrega a sessão nativa ao WebView do host; a fan-out por espectador
  remoto ainda usa a sinalização da sala e requer a validação descrita abaixo);
- H.264 como perfil inicial interoperável; HEVC só é anunciado quando encoder,
  navegador receptor e SDP confirmarem suporte;
- áudio Opus separado, sem recapturar preview/voz;
- validação de tamanho, remetente, sessão e estado antes de aceitar SDP/ICE;
- nenhuma chamada nativa a `getDisplayMedia()` e nenhum quadro bruto no IPC;
- teste LAN, internet/TURN, reconexão, parada e pelo menos 20 ciclos de
  iniciar/parar em uma máquina Windows limpa.

`CaptureCapabilities.available` passa a refletir `worker_available` e
`bridge_available` quando o runtime e `webrtcbin` estão presentes. A sessão
continua recusando fontes inválidas e não libera a UI quando a ponte não pode
ser criada.

## Validação ainda necessária

O código e o runtime estão preparados, mas a aceitação de produto ainda exige
teste manual em Windows limpo: janela e monitor reais, WebView2, LAN/TURN,
reconexão, áudio, encerramento e 20 ciclos iniciar/parar. HEVC, áudio por
processo, múltiplos espectadores e clipes também permanecem condicionados a
essa validação ponta a ponta.
