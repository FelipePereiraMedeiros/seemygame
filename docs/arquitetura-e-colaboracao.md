# Arquitetura e colaboração

O fluxo de execução é `HTML → pages → entries/session → core + protocol + plugins → engines/adapters`. As páginas montam uma única sessão. Imports de serviços apenas disponibilizam funções e classes; não iniciam captura, rede ou listeners da página.

## Onde implementar

| Responsabilidade | Local | Contrato |
| --- | --- | --- |
| Montagem e saída da página | `js/pages/` | Uma montagem; descarte em `pagehide`. |
| Streamer, Viewer e Room | `js/session/` | Factories com estado, chat, voz, Co-op, áudio e telemetria próprios. |
| APIs de entrada | `js/entries/` | Fachadas públicas; não montar por import. |
| Eventos, dispatcher e ciclo de vida | `js/core/` | Recursos registrados no dono da sessão; falhas de handlers isoladas. |
| Mensagens e admissão | `js/protocol/`, `js/room/` | Validar origem, autorização e limites antes de executar features. |
| Recursos compartilhados entre páginas | `js/plugins/` | `init(context)` / `destroy()`; composição em `session-composition.js`. |
| Captura e seleção de fonte | `js/capture.js`, `js/capture/`, `js/browser-capture.js` | Provider retorna `{stream, session}`; captura obsoleta é cancelada. |
| Voz, áudio e replay | `js/voice/`, `js/audio/`, `js/clipping/` | Escopos de áudio por sessão; gravação e exportação por fonte. |
| Co-op e dispositivos | `js/coop/`, `js/desktop/` | Estado do controller por sessão; IPC e Companion separados de P2P. |
| UI e engines | `js/ui/`, `js/discord-ui/`, `js/whiteboard/`, `js/gamepad-3d-viewer/` | Engines mantêm seu estado; módulos internos organizam comportamentos por responsabilidade. |
| SDP, sender e métricas | `js/webrtc/`, `js/stats/` | Coleta pura separada de timer e HUD. |
| Estilos | `css/main/`, `css/landing/`, `css/components/` | Raízes importam módulos na ordem original da cascata. |
| Modais HTML | `templates/` | Editar a fonte e executar `npm run build:html`. |
| Captura e mídia nativas | `src-tauri/src/media/`, `capture/`, `webrtc_bridge/`, `native_viewer/` | Configuração, runtime, pipelines, negociação e comandos separados; DTOs/IPC preservados. |
| Infraestrutura E2E | `tools/e2e/harness/`, `fixtures/`, `telemetry/` | Servidor local, sinalização, navegador, limpeza, proveniência e métricas reutilizáveis. |

`js/app.js`, `js/coop.js`, `js/ui.js` e outras raízes preservam exports existentes. O runtime de compatibilidade fica em `js/app/` e só é montado explicitamente. Novas páginas usam as factories de sessão; novas features entram pela composição de plugins. Não acrescentar uma segunda inicialização à fachada antiga.

Os engines usam composição de comportamentos internos para manter uma API pública estável e um único dono do estado. Não acessar campos de outro engine para contornar sua API. Builders de geometria, DTOs, fixtures e runners de cenários podem continuar extensos quando têm uma responsabilidade única; tamanho isoladamente não exige subdivisão.

## Contratos de sessão e recursos

`createViewerSession`, `createStreamerSession` e `createRoomSession` criam instâncias independentes. A mesma factory recusa inicialização concorrente até descartar sua sessão. Os wrappers de `entries` mantêm uma instância padrão para compatibilidade das páginas e testes.

Registrar listeners com `session.addEventListener` e recursos com `session.registerCleanup`. Usar `dispose()` para iniciar o encerramento idempotente e `await session.disposeAsync()` quando o chamador precisar confirmar que liberações assíncronas terminaram. Uma assinatura que termina de instalar depois do descarte deve registrar seu `unlisten`: o contexto o executará imediatamente e acompanhará a Promise.

Captura, microfone, negociação e amostragem devem verificar cancelamento/geração depois de cada espera relevante. Uma operação antiga não pode publicar estado numa sessão encerrada. Não registrar cleanup que leia um provider mutável; capturar a instância proprietária no callback.

`AudioScope` possui os contextos. Playback é compartilhado dentro da sessão; mixer do recorder e teste de dispositivo têm propósitos próprios. Consumidores desconectam seus nós, e somente o dono fecha os contextos. Serviços injetados com escopo emprestado não o fecham automaticamente.

## Protocolo e unidades

Enviar mensagens P2P por `sendSessionMessage`. O envelope contém `type`, `msgId`, `timestamp` e `senderPeerId`. `senderPeerId` identifica o salto atual e é confrontado com `connection.peer`; um relay preserva `msgId` e troca a identidade do salto. Payloads legados sem metadados continuam aceitos. IDs de entidades da lousa não são IDs de mensagem; atualizações da mesma entidade não devem ser descartadas como duplicatas.

Admissão/PIN/roomKey continuam no domínio da sala e do Streamer. Features só recebem mensagens de peers admitidos. O dispatcher contém exceções/rejeições e acumula métricas; handlers continuam síncronos ou retornam Promise sem obrigar todos os consumidores a mudar sua API. O protocolo WebSocket do Companion permanece independente dos envelopes PeerJS.

Bitrate dos senders: bits/s. Provider nativo: kbit/s. Métricas WebRTC: RTT em ms, bitrate em Mbps, resolução em pixels. Não converter essas unidades implicitamente no HUD.

## Trabalho de Diogo e Felipe

Combinar a responsabilidade de cada PR por domínio: por exemplo, um altera captura/IPC e o outro lousa/UI. Mudanças em contratos públicos, composição e templates compartilhados precisam aparecer claramente na descrição do PR. Manter correções de comportamento acompanhadas de regressões; extrações devem preservar exports e wire format.

Fluxo desejado: `Felipe/dev → Felipe/alfa → Felipe/main → Diogo/main (produção/Vercel)`. Promover por PR com os checks aprovados e revisão do domínio afetado. Este documento registra a convenção; não altera proteção de branches, remotes ou deploys. O workspace está na `dev`, acompanhando `upstream/dev`.

## Verificação canônica

```sh
npm ci
npm run verify
npm run test:e2e:sessions
npm run test:e2e:whiteboard
```

Os E2E usam Chrome por padrão. Para Chromium do Playwright: instalar com `npx playwright install chromium` e definir `SEEMYGAME_BROWSER_CHANNEL=chromium`. A CI instala Chromium e executa essas verificações. O E2E de sessões usa mídia sintética do canvas, conexão WebRTC/DataChannel real e sinalização PeerJS local, sem produção.

No Windows com o SDK/runtime GStreamer preparado:

```sh
npm run native:prepare
npm run native:smoke
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
python -m unittest discover -s tests -p test_pending_companion.py
```

Depois de mudar templates, executar `npm run build:html` e incluir tanto fontes quanto páginas geradas. `check:html` detecta divergências. `check:css` verifica imports sem reescrever CSS por números de linha. `check:modules` examina todos os módulos autorais e imports literais; `test:smoke` vincula os serviços e verifica ausência de efeitos de inicialização.

Drivers históricos de benchmark nativo e rede continuam disponíveis, com servidor/proveniência compartilhados. Homologação física de captura de jogo, dispositivos e TURN entre redes distintas exige seus próprios ensaios. A aprovação das suítes locais não equivale a essa homologação nem à execução remota da CI.
