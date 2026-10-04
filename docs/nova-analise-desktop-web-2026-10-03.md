# Nova análise de código e E2E desktop–web / web–web

Data local: 03/10/2026. Base inicial: commit `64521b8`; checkout inicialmente limpo. Este relatório registra as correções e validações feitas sobre essa base.

## Resultado

Os problemas relatados de mic/fone e “Conectando...” foram reproduzidos e corrigidos. Também foram corrigidos o estado de voz apresentado ao outro participante, o nome/contador da sala no cabeçalho e declarações incorretas do relatório E2E. A comunicação desktop–web funciona nos dois sentidos e o web–web funciona com captura real de janela.

A revisão cobriu composição de sessões, controladores da interface, protocolo/presença de voz, captura e negociação de vídeo, instrumentação E2E e integração Rust/GStreamer. A suíte automatizada também reexercitou os casos das correções anteriores.

## Achados e correções

| Achado | Evidência e causa | Correção |
|---|---|---|
| P1 — Mic/fone não controlavam o áudio da sala | Os mixins de `DiscordUIController` consultavam o singleton importado de `voice.js`, embora a sessão tivesse outro `VoiceManager`. Mesmo com áudio conectado, o botão via `isInVoice=false` no singleton e tentava entrar novamente. Antes da correção, mute/deafen permaneciam falsos e as faixas continuavam habilitadas. | Mixins usam `this.voiceManager`, `this.chatManager` e `this.soundboardManager`; controles são inicializados com o estado da sessão. Corrigidos dock, atalhos e painel lateral, incluindo volumes/assinaturas dos eventos. Compatibilidade com consumidores legados preservada no construtor. |
| P2 — Estado remoto de voz incorreto | Após corrigir os controles locais, o E2E detectou que o outro participante não recebia mute/deafen em seu `VoiceManager`. A presença do Room e a lista de voz eram estados separados. Os callbacks do dock também não cobriam PTT ou mute automático ao ensurdecer. | `bindRoomVoiceState` publica estados completos por eventos do manager da sessão, aplica presença autorizada a participantes remotos e trata áudio que chega depois da atualização de membros. Eventos de fala local são propagados; mudanças de volume sem alteração de presença não geram broadcasts extras. Assinaturas são removidas ao encerrar a sessão. |
| P2 — Cabeçalho mantinha “Conectando...” | `#copy-badge` continha um texto inicial sem atualização no fluxo Room. A inspeção visual também encontrou `Sala: #geral` e `0 online` em uma sala com outro nome e dois participantes. | `bindRoomIdentity` acompanha registro, desconexão/reconexão e erros de sinalização; mostra o nome atual. Contador superior e identidade local acompanham presença real. Botões de convite são vinculados e preservam chave/PIN; no desktop, o convite usa a origem web pública em vez da origem interna do WebView. Falhas isoladas de chamadas de mídia não transformam a conexão de sinalização em erro. |
| P3 — Relatório E2E declarava condições erradas | A execução informou `captureBackend=d3d12`/NVENC, mas a tabela dizia “Direct3D 11”. O texto também fixava 1280×720 independentemente do perfil solicitado. | Tabela e declarações usam o backend observado e as dimensões/FPS do perfil selecionado; resoluções efetivamente entregues continuam registradas separadamente. |

Arquivos principais: `js/discord-ui.js`, `js/discord-ui/{stage,voice,drawer,chat,soundboard}.js`, `js/session/{room-session,room-identity,room-voice-state}.js`, `tools/e2e/run.mjs`.

## Matriz executada

| Cenário | Verificações | Resultado |
|---|---|---|
| Web–web, dois contextos Chrome com microfone de teste | Entrada real na sala; canal de áudio PeerJS; mic desabilita faixas brutas/processadas ainda vivas; deafen silencia elemento/ganho remoto; estado chega ao outro peer; restauração de saída/mic; dock, painel lateral e atalhos nas duas pontas; título e contador corretos | Passou |
| Reconexão da sinalização web | `peer.disconnect()` real muda o cabeçalho para “Conectando...”; `reconnect()` registra novamente e restaura o nome da sala | Passou |
| Desktop Tauri/WebView2 → Chrome | Executável recompilado; frontend embarcado confrontado com o checkout; entrada autenticada; controles de voz nas duas pontas; captura WGC/D3D12/H.264/NVENC; transporte GStreamer direto; vídeo decodificado com avanço de quadros; parar captura pela UI | Passou |
| Chrome → desktop Tauri/WebView2 | `getDisplayMedia` real de janela dedicada, faixa viva; vídeo reproduzido no desktop; captura encerrada sem stream local restante | Passou |
| Chrome → Chrome, captura real | Dois navegadores; controles de voz nas duas pontas; `getDisplayMedia` de janela dedicada; vídeo remoto decodificado; parada da captura | Passou |
| Streamer/Viewer web | PIN incorreto rejeitado antes da mídia; PIN correto aceito; vídeo decodificado; chat pelo DataChannel | Passou |
| Relay de chat | Identidade sanitizada do convidado preservada em um segundo Viewer | Passou |
| Room com três peers e entrada tardia | Admissão, compartilhamento e vídeo decodificado por quem entra depois | Passou |
| Whiteboard pelo protocolo real | Snapshot PNG grande; remoção de elementos obsoletos; ordem de camadas preservada | Passou |

O teste dedicado dos controles está disponível em `npm run test:e2e:room-controls`. O runner desktop ganhou `--exercise-voice-controls`; a voz é encerrada antes da coleta de vídeo para não adicionar processamento de áudio à medição.

## Evidências

- Reprodução anterior: `docs/nova-analise-controls-before.log` e `output/playwright/room-controls-1791075114759/report.json`. Cabeçalho conectando, mute/deafen falsos e faixas habilitadas após clicar.
- Controles e cabeçalho corrigidos, incluindo reconexão: `output/playwright/room-controls-1791077519202/report.json`; `errors=[]`.
- Desktop–web inicial nos dois sentidos: `output/playwright/2026-10-04T01-05-31-221Z-7db75c/report.json`. Este artefato preserva a declaração antiga incorreta de D3D11; o estado nativo nele prova D3D12. A execução final é registrada abaixo.
- Desktop–web final, com cabeçalho/contador verificados e declarações corrigidas: `output/playwright/2026-10-04T01-35-26-479Z-f90bb0/report.json`; **passou** nos dois sentidos, com dock, painel lateral e atalhos exercitados em ambos os endpoints.
- Web–web com captura real: `output/playwright/2026-10-04T01-26-25-259Z-d7132c/report.json`.
- Cenários de sessão/PIN/chat/relay/quadro: `docs/nova-analise-sessions.log`.
- Compilação desktop: `docs/nova-analise-desktop-build-final.log`; executável `src-tauri/target/debug/seemygame.exe`.
- Testes Rust: `docs/nova-analise-rust-tests.log`: **45 aprovados, zero falhas, dois benchmarks ignorados pela configuração original**. São sondas de cadência do encoder e etapas da captura, que requerem execução isolada/uma janela sintética visível; não foram alterados ou contabilizados como aprovados.
- Verificação JS/build final: `npm run verify`, **109 arquivos / 1.080 testes aprovados**, além de checks de módulos/HTML/CSS, smoke ESM e build dist. Foi usado `FFMPEG_BIN` apontando para o FFmpeg funcional instalado pelo WinGet nos testes de replay, sem alterar o PATH global. Evidência: `docs/nova-analise-verify.log`.
- Regressões específicas finais: **33 testes aprovados** em quatro arquivos; nove casos novos em `tests/room-controls-regression.test.js`. Evidência: `docs/nova-analise-final-regression.log`. `git diff --check` e a checagem de sintaxe do runner também passaram.

## Observação de desempenho ainda aberta

Na execução real web–web, o perfil pediu 1920×1080 a 60 FPS, mas o receptor recebeu **1280×720 e aproximadamente 19,7 FPS**. A fonte produzia cerca de 56,6 callbacks/s na amostra examinada, enquanto o RTP de saída enviava 20 FPS e declarava `qualityLimitationReason=bandwidth`. O encoder informado foi `MediaFoundationVideoEncodeAccelerator (AMDh264Encoder)`; não houve perda de pacotes nessa amostra. A fase web → desktop também ficou perto de 19,7 FPS; a fase nativa inicial decodificou cerca de 60,4 FPS.

Isso é uma observação reproduzida que merece investigação de qualidade/congestionamento do caminho de captura/encoder web. O código e as métricas disponíveis não estabelecem uma causa única; não foi aplicada uma alteração especulativa em bitrate ou encoder. Os E2E acima avaliam conexão, controles, entrega e encerramento de mídia e não certificam o perfil 1080p60. A opção `--require-quality` não foi utilizada.

A repetição desktop–web com o build final observou cerca de **60,1 FPS no caminho nativo D3D12** e **20,1 FPS no caminho web**. A limitação de cadência do web, portanto, permanece registrada mesmo com os defeitos funcionais corrigidos.

## Condições e uso da correção

Os participantes foram executados na mesma máquina Windows, com sinalização local e microfones sintéticos. Faixas WebRTC e ganhos de áudio foram efetivamente inspecionados, mas microfones/alto-falantes físicos e duas redes com TURN não foram testados. O WebView2 de teste usa bypass de CSP para a sinalização efêmera; a CSP de publicação não foi validada. A leitura óptica foi desativada, portanto não há conclusão sobre latência visual ponta a ponta.

O site publicado não foi atualizado por esta tarefa. O desktop testado é o build debug atualizado; o executável release antigo não deve ser confundido com este build. Para disponibilizar a correção, o web e o pacote desktop precisam receber estes arquivos/recompilação.
