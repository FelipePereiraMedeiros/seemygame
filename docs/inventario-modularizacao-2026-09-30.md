# Inventário por arquivo — modularização SeeMyGame

> Fotografia histórica anterior à implementação. Consulte [status atualizado](status-modularizacao-2026-09-30.md) para o fechamento dos achados.

Base: `dev`, commit `b530e17ac37f4c86dba91f288235cb7703ac3dfa`. Data: 30/09/2026. **260 arquivos rastreados**, sem contar os documentos novos desta auditoria.

Este anexo complementa a [auditoria e plano de PRs](auditoria-modularizacao-2026-09-30.md). IDs M01–M18 remetem aos achados do relatório. Um encaminhamento é uma proposta, não uma mudança já aplicada. Arquivos pequenos/coerentes permanecem inteiros. Para binários, a verificação foi de inventário/hash, sem revisão visual. Testes `.mjs` não executados não recebem status de aprovação.

## JavaScript autoral do frontend (45)

| Arquivo | Linhas | Encaminhamento |
| --- | ---: | --- |
| [js/abr.js](../js/abr.js) | 206 | M12: manter engine por peer; injetar política de qualidade e callback; não transportar sua aplicação ao DOM para o engine. |
| [js/app.js](../js/app.js) | 6155 | M01–M05/M07/M09/M10: extrair composição, sessão, transporte, mídia e controllers conforme mapa de cortes; conservar fachada temporária sem duplicar algoritmo. |
| [js/audio-devices.js](../js/audio-devices.js) | 238 | M11: separar preferências/devices do preenchimento de select e teste de saída; explicitar propriedade do contexto temporário. |
| [js/audio-meme.js](../js/audio-meme.js) | 400 | M11: separar transforms de AudioBuffer, serialização WAV/base64 e playback; receber contexto e política de encerramento. |
| [js/audio.js](../js/audio.js) | 310 | M11/M12: separar VU engine/view e processamento de microfone; contexto e nós com ownership definido. |
| [js/browser-capture.js](../js/browser-capture.js) | 58 | M12: manter módulo pequeno de constraints/request; consolidar uso por BrowserCaptureProvider e captura da sessão. |
| [js/capture.js](../js/capture.js) | 316 | M02/M05: preservar state machine/cancelamento; providers Browser/Native separados atrás do contrato start/stop/disposeResult. |
| [js/chat.js](../js/chat.js) | 244 | M06/M12: manter modelo/canais/limites observável; não acoplar DOM; revisar sanitização com contrato específico. |
| [js/clipping.js](../js/clipping.js) | 756 | M10/M12: separar recorder, mixer, buffer/flush/export e registry multi-source; corrigir contrato do wrapper antes de migrar. |
| [js/config.js](../js/config.js) | 257 | M18: separar produto, origem/ambiente, qualidade e cliente/cache de TURN; não espalhar configurações por controllers. |
| [js/coop.js](../js/coop.js) | 1583 | M12: separar host/viewer, slots, input, adapters, mapping e tester; preservar autorização, revogação e reset. |
| [js/core/audio-context-pool.js](../js/core/audio-context-pool.js) | 77 | M11: integrar via porta/ownership; não substituir contextos dedicados sem comparar sink, mixer e cleanup. |
| [js/core/event-bus.js](../js/core/event-bus.js) | 135 | M08/M09: tratar rejeição async, explicitar contratos e garantir unsubscribe por sessão; não descreve circuit breaker implementado. |
| [js/core/message-dispatcher.js](../js/core/message-dispatcher.js) | 186 | M01/M04/M07/M08: export/instância canônica, envelope/dedup e falhas async; handlers com origem admitida. |
| [js/core/plugin-manager.js](../js/core/plugin-manager.js) | 88 | M04/M09: criar por sessão; contrato de lifecycle, substituição de registro e contexto consistente. |
| [js/desktop.js](../js/desktop.js) | 467 | M18: adapter invoke/events comum e módulos capture/viewer/gamepad/window; fachada pública e normalizadores durante migração. |
| [js/discord-ui.js](../js/discord-ui.js) | 1202 | M02/M09/M12: shell + controllers de chat/voz/soundboard/presença/stage; dependências injetadas e dispose. |
| [js/entries/index.js](../js/entries/index.js) | 8 | M01/M03: evitar importação agregada com auto-boot e exports estrela conflitantes; APIs explícitas. |
| [js/entries/lobby-entry.js](../js/entries/lobby-entry.js) | 218 | M03/M14: substituir inline somente após preservar key, base path e comportamento de termos; montagem/desmontagem única. |
| [js/entries/room-entry.js](../js/entries/room-entry.js) | 255 | M01–M04/M14: corrigir contratos RoomManager/Relay/Voice/UI, roomKey, admissão e composition root. |
| [js/entries/streamer-entry.js](../js/entries/streamer-entry.js) | 370 | M01–M04: corrigir contratos captura/card/prompt/dispatcher; paridade de PIN, mídia nativa e controles antes de ativar. |
| [js/entries/viewer-entry.js](../js/entries/viewer-entry.js) | 287 | M01–M04: corrigir linking/card/stats/contexto; paridade de admissão, reconexão e teardown por host. |
| [js/gamepad-3d-viewer.js](../js/gamepad-3d-viewer.js) | 993 | M12: separar loader/materials/mapping/render; preservar destroy completo e carregar somente no fluxo pertinente. |
| [js/gamepad-model-builder.js](../js/gamepad-model-builder.js) | 525 | M12: componentes de peças apenas se facilitar edição simultânea; versão conjunta com gerador e GLB. |
| [js/landing-demo.js](../js/landing-demo.js) | 62 | Manter controller pequeno da demonstração; não envolver núcleo P2P na landing. |
| [js/native-webrtc.js](../js/native-webrtc.js) | 374 | M05/M12: adapter da ponte local; helpers ICE/frame/track e sessão separados, preserving timeout e cleanup. |
| [js/ping.js](../js/ping.js) | 263 | M10/M11: engine/render e som com ownership; UI/inputs ficam no controller do plugin. |
| [js/plugins/base-plugin.js](../js/plugins/base-plugin.js) | 86 | M04/M09: lifecycle e cleanup determinísticos por instância; documentar contexto mínimo. |
| [js/plugins/clipping-plugin.js](../js/plugins/clipping-plugin.js) | 84 | M10: compatibilizar registry/export e eventos por fonte; não perder replay multi-stream. |
| [js/plugins/index.js](../js/plugins/index.js) | 10 | M04/M10: registro explícito de classes/fábricas; não compartilhar singletons entre managers de sessões distintas. |
| [js/plugins/ping-plugin.js](../js/plugins/ping-plugin.js) | 100 | M10/M09: reunir binding UI/input com handlers e cleanup do engine; não duplicar app.initTacticalPing. |
| [js/plugins/reactions-plugin.js](../js/plugins/reactions-plugin.js) | 95 | M10/M09: controller completo, autorização/broadcast injetados e cleanup de listeners/DOM. |
| [js/plugins/soundboard-plugin.js](../js/plugins/soundboard-plugin.js) | 69 | M10/M11: rede, playback e controller com contexto/sink definidos; unificar presets/custom contracts. |
| [js/plugins/whiteboard-plugin.js](../js/plugins/whiteboard-plugin.js) | 139 | M10/M09: separar adapter de sync do controller de toolbar/input; desmontar recursos além dos handlers de rede. |
| [js/qrcode-light.js](../js/qrcode-light.js) | 272 | Manter algoritmo coeso e independente; sem necessidade de pulverizar ECC/bitbuffer em vários arquivos. |
| [js/reactions.js](../js/reactions.js) | 102 | Manter engine pequeno com allowlist/rate-limit; acrescentar contrato de cleanup se utilizado como recurso de sessão. |
| [js/relay.js](../js/relay.js) | 319 | M02/M12: manter cálculo/topologia puro, contrato de opções único; executar chamadas em adapter de mídia. |
| [js/room-codes.js](../js/room-codes.js) | 156 | M06/M14: parsing/geração puros; sanitização compartilhada sem depender de RoomManager/UI; preservar key. |
| [js/room.js](../js/room.js) | 919 | M06/M07/M12: estado/admissão/presença/heartbeat e handlers; identidade valida via módulo puro. |
| [js/soundboard.js](../js/soundboard.js) | 312 | M10/M11: storage/presets, engine de playback e callbacks de mudança; ownership de contexto e dispose. |
| [js/stats.js](../js/stats.js) | 256 | M02/M12: coletor por peer e cálculos separados da renderização HUD; contrato de unidades explícito. |
| [js/ui.js](../js/ui.js) | 965 | M06/M12: validação pura fora da UI; card, termos, toasts e Co-op em componentes; função card tem 530 linhas. |
| [js/voice.js](../js/voice.js) | 920 | M06/M12: modelo, VAD, mixer/devices/playback e chamadas; remover validação importada da UI. |
| [js/webrtc.js](../js/webrtc.js) | 452 | M12: SDP puro e políticas de sender/receiver/audio em módulos coesos; API estável nas fachadas. |
| [js/whiteboard.js](../js/whiteboard.js) | 1301 | M12: documento/histórico, geometria, render, input e imagens; sync remoto no adapter e dispose explícito. |

## Rust de produto (9)

| Arquivo | Linhas | Encaminhamento |
| --- | ---: | --- |
| [src-tauri/src/capture.rs](../src-tauri/src/capture.rs) | 1301 | M15/M16: commands/types/session/health + fanout/registry separados; controle testável fora de cfg(not(test)). |
| [src-tauri/src/gamepad.rs](../src-tauri/src/gamepad.rs) | 618 | M15: DTO/mapping, backend Windows, registry, commands e driver; preservar slot/reset e fallback. |
| [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) | 108 | M15/M16: composition root e registration; testes e check de produção separados. |
| [src-tauri/src/main.rs](../src-tauri/src/main.rs) | 25 | Manter bootstrap pequeno; opções WebView2/prioridade em configuração de plataforma se precisarem evoluir. |
| [src-tauri/src/media.rs](../src-tauri/src/media.rs) | 1602 | M15: config/runtime/pipeline/worker e leases UDP; helpers puros primeiro, propriedade de processo depois. |
| [src-tauri/src/native_viewer.rs](../src-tauri/src/native_viewer.rs) | 604 | M15: pipeline/viewer, render Win32, commands e helpers GStreamer compartilhados. |
| [src-tauri/src/system.rs](../src-tauri/src/system.rs) | 65 | Manter adapter de janela/prioridade/log pequeno; separar logging apenas se virar responsabilidade independente. |
| [src-tauri/src/webrtc_bridge.rs](../src-tauri/src/webrtc_bridge.rs) | 838 | M15: helpers de GStreamer/Promise/RTP/SDP comuns, bridge state separado; preservar timeouts e teardown. |
| [src-tauri/src/windows_list.rs](../src-tauri/src/windows_list.rs) | 667 | M15: enumeração, registry/revalidação e audio-process candidates em submódulos Windows. |

## HTML e fixture de página (7)

| Arquivo | Linhas | Encaminhamento |
| --- | ---: | --- |
| [fixtures/deterministic-60fps.html](../fixtures/deterministic-60fps.html) | 321 | M17: manter fonte sintética independente/reproduzível; alinhar marker protocol com harness óptico. |
| [index.html](../index.html) | 404 | M14: comportamento de navegação/termos fora de inline; manter landing independente da sessão P2P. |
| [lobby.html](../lobby.html) | 297 | M03/M14: migrar inline para entry preservando geração/propagação de key, subpath e termos. |
| [room.html](../room.html) | 1098 | M01–M03/M14: um entrypoint de sala, templates por feature; importmap correto para vendor permanece na resolução do 3D. |
| [streamer.html](../streamer.html) | 721 | M01–M03/M14: um entrypoint de streamer; templates/controllers de captura, tuning e consentimento. |
| [test-audio.html](../test-audio.html) | 108 | Manter página diagnóstica pequena; extrair runner se crescer/compartilhar contratos de device. |
| [viewer.html](../viewer.html) | 539 | M01–M03/M14: um entrypoint de viewer; templates/controllers de recepção e consentimento. |

## CSS (9)

| Arquivo | Linhas | Encaminhamento |
| --- | ---: | --- |
| [css/components/discord-drawer.css](../css/components/discord-drawer.css) | 1444 | M13: dividir drawer/chat/voz/soundboard e room stage/layout mantendo cascata e media queries. |
| [css/components/hud-telemetry.css](../css/components/hud-telemetry.css) | 66 | Manter pequeno e coeso, junto ao contrato visual do HUD. |
| [css/components/modals.css](../css/components/modals.css) | 990 | M13: separar picker/Green Room/share/gamepad/replay por feature, base comum em primitives. |
| [css/components/video-grid.css](../css/components/video-grid.css) | 819 | M13: separar card/grid, controles e overlays se edições concorrentes; conferir cascata visual. |
| [css/components/whiteboard.css](../css/components/whiteboard.css) | 324 | Manter feature coesa; controller, template e stylesheet devem migrar em conjunto. |
| [css/landing-premium.css](../css/landing-premium.css) | 166 | M13: escopo .smg-landing já delimita responsabilidade; preservar direção visual e ordem de overrides. |
| [css/landing.css](../css/landing.css) | 1009 | M13: separar landing/lobby e utilidades compartilhadas onde o consumo permitir. |
| [css/main.css](../css/main.css) | 801 | M13: tokens/reset/base, layout e primitives; evitar styles de features globais. |
| [css/player.css](../css/player.css) | 8 | M13: manter entrada de imports; não executar o antigo splitter contra este arquivo. |

## Ferramentas (18)

| Arquivo | Linhas | Encaminhamento |
| --- | ---: | --- |
| [tools/build-dist.js](../tools/build-dist.js) | 42 | M18: empacotamento coeso; deve validar grafo/artefatos em gate separado; templates futuros exigem build web/desktop alinhado. |
| [tools/coop-agent.py](../tools/coop-agent.py) | 466 | M12/M18: fronteiras opcionais Companion protocol/auth/server/input/gamepad/state; manter launcher e release_slot/release_all/failsafe em testes. |
| [tools/e2e/desktop-affinity.mjs](../tools/e2e/desktop-affinity.mjs) | 97 | M17: adapter de desktop do harness; não duplicar relaunch/check nos cenários. |
| [tools/e2e/optical.mjs](../tools/e2e/optical.mjs) | 223 | M17: manter cálculo puro canônico; compartilhar decoder/CRC com browser injetado por mecanismo explícito. |
| [tools/e2e/run.mjs](../tools/e2e/run.mjs) | 913 | M17: separar config, servidor, drivers, fixture, instrumentação, fases, report e cleanup. |
| [tools/e2e/telemetry.mjs](../tools/e2e/telemetry.mjs) | 775 | M17: instalação/coleta no browser, deltas/agregação e budgets/report separados. |
| [tools/e2e/test-deterministic-battery.mjs](../tools/e2e/test-deterministic-battery.mjs) | 1597 | M17: harness comum e cenários declarados; preservar fixture sintética, session magic e critérios reais de sucesso. |
| [tools/e2e/test-picker.mjs](../tools/e2e/test-picker.mjs) | 69 | M17: cenário do harness dedicado ao seletor; fixture e browsers compartilhados. |
| [tools/e2e/test-youtube-isolation.mjs](../tools/e2e/test-youtube-isolation.mjs) | 2 | M17: alias de compatibilidade para battery; nome/documentação deixam clara a substituição por fixture determinística. |
| [tools/e2e/wait.mjs](../tools/e2e/wait.mjs) | 8 | M17: manter helper pequeno canônico para predicates async; reutilizar sem duplicação. |
| [tools/generate-gamepad-glb.mjs](../tools/generate-gamepad-glb.mjs) | 56 | M12/M18: pipeline de asset com versão do builder/Three; output explícito e reproducível. |
| [tools/install-vigem.ps1](../tools/install-vigem.ps1) | 98 | M18: ferramenta de provisioning separada do engine de gamepad; invocação por adapter dedicado. |
| [tools/prepare-native-media.ps1](../tools/prepare-native-media.ps1) | 138 | M18: provisioning canônico runtime/SDK; alinhar scripts npm e documentar versão/manifesto. |
| [tools/serve.mjs](../tools/serve.mjs) | 69 | M17/M18: reutilizar servidor estático com root/port/host configuráveis no harness; não simula a função TURN. |
| [tools/split-css.mjs](../tools/split-css.mjs) | 79 | M13 P1: migração de uso único com input antigo; NÃO reexecutar contra player.css modular sem guarda. |
| [tools/test-latency-comparison.mjs](../tools/test-latency-comparison.mjs) | 402 | M17: usar harness/telemetry comum; separar relatório e cenários desktop/web. |
| [tools/test-pending.mjs](../tools/test-pending.mjs) | 22 | M17/M18: runner multilíngue; nomear por objetivo de gate e preservar execução/exit code de cada suíte. |
| [tools/validate-native-media.ps1](../tools/validate-native-media.ps1) | 110 | M18: health/probe/smoke do runtime; alinhar native:smoke e critérios com capacidades Rust. |

## Testes e suporte (84)

| Arquivo | Linhas | Encaminhamento |
| --- | ---: | --- |
| [tests/abr.test.js](../tests/abr.test.js) | 89 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/abr.js. Não apagar casos apenas por nomes históricos. |
| [tests/app.test.js](../tests/app.test.js) | 586 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/audio-context-pool.test.js](../tests/audio-context-pool.test.js) | 31 | M11: pool isolado aprovado; testar ownership e integração quando consumidores migrarem. |
| [tests/audio-devices.test.js](../tests/audio-devices.test.js) | 208 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/audio-devices.js. Não apagar casos apenas por nomes históricos. |
| [tests/audio-meme.test.js](../tests/audio-meme.test.js) | 355 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/audio-meme.js. Não apagar casos apenas por nomes históricos. |
| [tests/audio.test.js](../tests/audio.test.js) | 227 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/audio.js. Não apagar casos apenas por nomes históricos. |
| [tests/audit-remediation.test.js](../tests/audit-remediation.test.js) | 242 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/chat.js, js/room.js, js/voice.js, js/app.js, js/abr.js, js/webrtc.js, js/config.js. Não apagar casos apenas por nomes históricos. |
| [tests/benchmark-mesh-stress.mjs](../tests/benchmark-mesh-stress.mjs) | 380 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/browser-capture.test.js](../tests/browser-capture.test.js) | 76 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/browser-capture.js. Não apagar casos apenas por nomes históricos. |
| [tests/capture.test.js](../tests/capture.test.js) | 164 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/capture.js. Não apagar casos apenas por nomes históricos. |
| [tests/cascade-failure-isolation.test.js](../tests/cascade-failure-isolation.test.js) | 38 | M08: contenção síncrona aprovada; async precisa de teste que observe rejeição/métricas. |
| [tests/chat.test.js](../tests/chat.test.js) | 138 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/chat.js. Não apagar casos apenas por nomes históricos. |
| [tests/clipping.test.js](../tests/clipping.test.js) | 217 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/clipping.js. Não apagar casos apenas por nomes históricos. |
| [tests/config.test.js](../tests/config.test.js) | 102 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/config.js. Não apagar casos apenas por nomes históricos. |
| [tests/coop.test.js](../tests/coop.test.js) | 577 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/coop.js. Não apagar casos apenas por nomes históricos. |
| [tests/css-components.test.js](../tests/css-components.test.js) | 82 | M13: verifica conteúdo/imports; complementar com verificação de cascata/aparência quando estilos forem extraídos. |
| [tests/desktop-picker.test.js](../tests/desktop-picker.test.js) | 163 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/desktop.test.js](../tests/desktop.test.js) | 283 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/desktop.js. Não apagar casos apenas por nomes históricos. |
| [tests/discord-ui.test.js](../tests/discord-ui.test.js) | 290 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/discord-ui.js, js/chat.js, js/voice.js. Não apagar casos apenas por nomes históricos. |
| [tests/e2e-720p-tree-benchmark.mjs](../tests/e2e-720p-tree-benchmark.mjs) | 452 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/e2e-green-room-audio.mjs](../tests/e2e-green-room-audio.mjs) | 179 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/e2e-late-joiner-trios.mjs](../tests/e2e-late-joiner-trios.mjs) | 543 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/e2e-multi-stream-scenario.mjs](../tests/e2e-multi-stream-scenario.mjs) | 533 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/e2e-room-persistence-audit.mjs](../tests/e2e-room-persistence-audit.mjs) | 378 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/e2e-telemetry.test.js](../tests/e2e-telemetry.test.js) | 578 | M16/M17: conservar regressões e mover/organizar por domínio após extração; verificar fixtures e consumidores de domínio. Não apagar casos apenas por nomes históricos. |
| [tests/e2e-tree-relay-benchmark.mjs](../tests/e2e-tree-relay-benchmark.mjs) | 369 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/e2e-vercel-live.mjs](../tests/e2e-vercel-live.mjs) | 207 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/e2e-visual-audit.mjs](../tests/e2e-visual-audit.mjs) | 423 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/e2e-wait.test.js](../tests/e2e-wait.test.js) | 24 | M16/M17: conservar regressões e mover/organizar por domínio após extração; verificar fixtures e consumidores de domínio. Não apagar casos apenas por nomes históricos. |
| [tests/e2e-whiteboard-multi-client.mjs](../tests/e2e-whiteboard-multi-client.mjs) | 249 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/e2e-whiteboard.mjs](../tests/e2e-whiteboard.mjs) | 237 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/entries.test.js](../tests/entries.test.js) | 129 | M01/M02/M16: testes atuais de exports/flags/estado não cobrem linking nativo nem paridade de cada fluxo; adicionar contratos comportamentais. |
| [tests/event-bus.test.js](../tests/event-bus.test.js) | 90 | M08: manter cobertura síncrona; acrescentar contrato explícito de falha async e teardown. |
| [tests/fixtures/README.md](../tests/fixtures/README.md) | 19 | Documentar replays e métodos de geração; fixture tem uma finalidade, não é engine a modularizar. |
| [tests/fixtures/replay-red-then-blue.webm](../tests/fixtures/replay-red-then-blue.webm) | binário | Asset de interface/fixture; inventariado por hash. Dono da feature ou pipeline de geração; sem refatoração de lógica interna. |
| [tests/gamepad-3d.test.js](../tests/gamepad-3d.test.js) | 882 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/gamepad-model-builder.js, js/gamepad-3d-viewer.js. Não apagar casos apenas por nomes históricos. |
| [tests/gamer-features.test.js](../tests/gamer-features.test.js) | 590 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js, js/ping.js, js/reactions.js, js/soundboard.js, js/abr.js, js/clipping.js, js/whiteboard.js. Não apagar casos apenas por nomes históricos. |
| [tests/h264-encoder-ui.test.js](../tests/h264-encoder-ui.test.js) | 133 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/capture.js, js/desktop.js, js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/isolated-plugins.test.js](../tests/isolated-plugins.test.js) | 155 | M04/M09/M10: manter testes de wrappers; exercitar também ligação feature/controller/engine/transport. |
| [tests/late-joiner-stream.test.js](../tests/late-joiner-stream.test.js) | 293 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/room.js, js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/message-dispatcher.test.js](../tests/message-dispatcher.test.js) | 80 | M01/M07/M08: manter dispatch/dedup/isolation; acrescentar contrato async e política de envelope. |
| [tests/mocks/webaudio.mock.js](../tests/mocks/webaudio.mock.js) | 89 | Manter mock de Web Audio reutilizável e contratual; instanciar por teste/fixture. |
| [tests/mocks/webrtc.mock.js](../tests/mocks/webrtc.mock.js) | 140 | Manter mock de WebRTC/MediaStream reutilizável; testar unidades/assinaturas reais nas bordas. |
| [tests/multi-instance-room.test.js](../tests/multi-instance-room.test.js) | 489 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/room.js, js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/native-hardening.test.js](../tests/native-hardening.test.js) | 163 | M16: import de localStream inexistente; fixtures devem acionar sessão real/injetada, sem falsa mutação de window.roomManager. |
| [tests/p2p-chat-voice.test.js](../tests/p2p-chat-voice.test.js) | 91 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js, js/chat.js, js/voice.js. Não apagar casos apenas por nomes históricos. |
| [tests/pending-capture.test.js](../tests/pending-capture.test.js) | 41 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/capture.js. Não apagar casos apenas por nomes históricos. |
| [tests/pending-replay-streams.test.js](../tests/pending-replay-streams.test.js) | 56 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/pending-replay.test.js](../tests/pending-replay.test.js) | 109 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/clipping.js. Não apagar casos apenas por nomes históricos. |
| [tests/pending-turn.test.js](../tests/pending-turn.test.js) | 39 | M16/M17: conservar regressões e mover/organizar por domínio após extração; verificar fixtures e consumidores de domínio. Não apagar casos apenas por nomes históricos. |
| [tests/pin-auth.test.js](../tests/pin-auth.test.js) | 567 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/ping.test.js](../tests/ping.test.js) | 102 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/ping.js. Não apagar casos apenas por nomes históricos. |
| [tests/plugin-manager.test.js](../tests/plugin-manager.test.js) | 77 | M04/M09: lifecycle e contexto por sessão, registro/reinit/destruição; comportamento além de APIs exportadas. |
| [tests/qrcode.test.js](../tests/qrcode.test.js) | 27 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/qrcode-light.js. Não apagar casos apenas por nomes históricos. |
| [tests/reactions.test.js](../tests/reactions.test.js) | 53 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/reactions.js. Não apagar casos apenas por nomes históricos. |
| [tests/relay-integration.test.js](../tests/relay-integration.test.js) | 260 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/room.js, js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/relay.test.js](../tests/relay.test.js) | 137 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/relay.js. Não apagar casos apenas por nomes históricos. |
| [tests/reload-confirm.test.js](../tests/reload-confirm.test.js) | 113 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/review-app-integration.test.js](../tests/review-app-integration.test.js) | 84 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js, js/voice.js, js/chat.js, js/config.js, js/clipping.js, js/abr.js. Não apagar casos apenas por nomes históricos. |
| [tests/review-audit-fixes.test.js](../tests/review-audit-fixes.test.js) | 373 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/clipping.js, js/coop.js. Não apagar casos apenas por nomes históricos. |
| [tests/review-desktop-contract.test.js](../tests/review-desktop-contract.test.js) | 29 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/desktop.js. Não apagar casos apenas por nomes históricos. |
| [tests/review-native-bridge.test.js](../tests/review-native-bridge.test.js) | 64 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/native-webrtc.js, js/capture.js. Não apagar casos apenas por nomes históricos. |
| [tests/review-replay-gamepad.test.js](../tests/review-replay-gamepad.test.js) | 53 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/clipping.js, js/coop.js. Não apagar casos apenas por nomes históricos. |
| [tests/review-telemetry.test.js](../tests/review-telemetry.test.js) | 10 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/stats.js. Não apagar casos apenas por nomes históricos. |
| [tests/room-app.test.js](../tests/room-app.test.js) | 310 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/room-codes.test.js](../tests/room-codes.test.js) | 99 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/room-codes.js. Não apagar casos apenas por nomes históricos. |
| [tests/room-pin-isolation.test.js](../tests/room-pin-isolation.test.js) | 402 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/room-voice-gamepad.test.js](../tests/room-voice-gamepad.test.js) | 101 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/ui.js, js/voice.js, js/coop.js. Não apagar casos apenas por nomes históricos. |
| [tests/room.test.js](../tests/room.test.js) | 351 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/room.js. Não apagar casos apenas por nomes históricos. |
| [tests/setup.js](../tests/setup.js) | 93 | M16/M17: separar factories de fixture por domínio; globals universais não substituem APIs reais. |
| [tests/soundboard.test.js](../tests/soundboard.test.js) | 116 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/soundboard.js. Não apagar casos apenas por nomes históricos. |
| [tests/stats.test.js](../tests/stats.test.js) | 281 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/stats.js. Não apagar casos apenas por nomes históricos. |
| [tests/test-audio-device-e2e.mjs](../tests/test-audio-device-e2e.mjs) | 209 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/test-stream-2-viewers.mjs](../tests/test-stream-2-viewers.mjs) | 273 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/test-stream-3-viewers.mjs](../tests/test-stream-3-viewers.mjs) | 284 | M17: cenário E2E/benchmark fora do npm test; extrair fixture/servidor/browser/cleanup comuns, preservando comportamento e URL de destino. |
| [tests/test_pending_companion.py](../tests/test_pending_companion.py) | 145 | 5 casos aprovados; manter regressões de auth/reset/failsafe/slots ao dividir o Companion. |
| [tests/tuning.test.js](../tests/tuning.test.js) | 188 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/discord-ui.js, js/desktop.js, js/capture.js, js/coop.js, js/app.js. Não apagar casos apenas por nomes históricos. |
| [tests/turn.test.js](../tests/turn.test.js) | 56 | M16/M17: conservar regressões e mover/organizar por domínio após extração; verificar fixtures e consumidores de domínio. Não apagar casos apenas por nomes históricos. |
| [tests/ui.test.js](../tests/ui.test.js) | 626 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/ui.js. Não apagar casos apenas por nomes históricos. |
| [tests/voice-ui-volume.test.js](../tests/voice-ui-volume.test.js) | 153 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/discord-ui.js, js/voice.js. Não apagar casos apenas por nomes históricos. |
| [tests/voice.test.js](../tests/voice.test.js) | 338 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/voice.js. Não apagar casos apenas por nomes históricos. |
| [tests/webrtc.test.js](../tests/webrtc.test.js) | 394 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/webrtc.js. Não apagar casos apenas por nomes históricos. |
| [tests/whiteboard-streaming.test.js](../tests/whiteboard-streaming.test.js) | 273 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/app.js, js/whiteboard.js. Não apagar casos apenas por nomes históricos. |
| [tests/whiteboard.test.js](../tests/whiteboard.test.js) | 555 | M16/M17: conservar regressões e mover/organizar por domínio após extração; dependências diretas: js/whiteboard.js. Não apagar casos apenas por nomes históricos. |

## Vendor (7)

| Arquivo | Linhas | Encaminhamento |
| --- | ---: | --- |
| [js/vendor/GLTFLoader.js](../js/vendor/GLTFLoader.js) | 4925 | M18: duplicata legada com imports relativos inexistentes; confirmar consumidores antes de retirar; código de terceiros. |
| [js/vendor/loaders/GLTFLoader.js](../js/vendor/loaders/GLTFLoader.js) | 4925 | M18: código de terceiros; catalogar versão/licença/origem e manter conjunto coerente; não refatorar como feature autoral. |
| [js/vendor/three.core.js](../js/vendor/three.core.js) | 60586 | M18: código de terceiros; catalogar versão/licença/origem e manter conjunto coerente; não refatorar como feature autoral. |
| [js/vendor/three.module.js](../js/vendor/three.module.js) | 19719 | M18: código de terceiros; catalogar versão/licença/origem e manter conjunto coerente; não refatorar como feature autoral. |
| [js/vendor/three.tsl.js](../js/vendor/three.tsl.js) | 691 | M18: código de terceiros; catalogar versão/licença/origem e manter conjunto coerente; não refatorar como feature autoral. |
| [js/vendor/utils/BufferGeometryUtils.js](../js/vendor/utils/BufferGeometryUtils.js) | 1501 | M18: código de terceiros; catalogar versão/licença/origem e manter conjunto coerente; não refatorar como feature autoral. |
| [js/vendor/utils/SkeletonUtils.js](../js/vendor/utils/SkeletonUtils.js) | 496 | M18: código de terceiros; catalogar versão/licença/origem e manter conjunto coerente; não refatorar como feature autoral. |

## Documentação histórica (44)

| Arquivo | Linhas | Encaminhamento |
| --- | ---: | --- |
| [docs/Diagnóstico E2E e Resolução da revisão técnica 17-09.md](../docs/Diagn%C3%B3stico%20E2E%20e%20Resolu%C3%A7%C3%A3o%20da%20revis%C3%A3o%20t%C3%A9cnica%2017-09.md) | 61 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/analise-e2e-1080p-2026-09-18.md](../docs/analise-e2e-1080p-2026-09-18.md) | 68 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/analise-latencia-captura-nativa-2026-09-16.md](../docs/analise-latencia-captura-nativa-2026-09-16.md) | 190 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/analise-pipelines-alternativas-2026-09-17.md](../docs/analise-pipelines-alternativas-2026-09-17.md) | 193 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/auditoria-2026-09-14-snapshot.json](../docs/auditoria-2026-09-14-snapshot.json) | 411 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/auditoria-2026-09-14.md](../docs/auditoria-2026-09-14.md) | 221 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/auditoria_visual_e2e.md](../docs/auditoria_visual_e2e.md) | 96 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/captura-nativa-implementacao.md](../docs/captura-nativa-implementacao.md) | 71 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/correcao-seletor-audio-web-2026-09-24.md](../docs/correcao-seletor-audio-web-2026-09-24.md) | 36 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/decimo-parecer-multi-instancia-salas-3p.md](../docs/decimo-parecer-multi-instancia-salas-3p.md) | 97 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/latencia-sintetica-h264-1080p.json](../docs/latencia-sintetica-h264-1080p.json) | 82 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/nono-parecer-resolucao-pacing-memoria-2026-09-24.md](../docs/nono-parecer-resolucao-pacing-memoria-2026-09-24.md) | 51 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/oitavo-parecer-encoders-audio-2026-09-19.md](../docs/oitavo-parecer-encoders-audio-2026-09-19.md) | 48 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/parecer-replica-r1-r10-2026-09-24.md](../docs/parecer-replica-r1-r10-2026-09-24.md) | 45 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/parecer-rodadas-youtube-2026-09-18.md](../docs/parecer-rodadas-youtube-2026-09-18.md) | 61 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/plano-captura-nativa.md](../docs/plano-captura-nativa.md) | 132 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/plano-consolidado-correcoes-testes-2026-09-16.md](../docs/plano-consolidado-correcoes-testes-2026-09-16.md) | 144 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/plano-web-jogos-meet-2026-09-24.md](../docs/plano-web-jogos-meet-2026-09-24.md) | 180 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/ponte-webrtc-nativa.md](../docs/ponte-webrtc-nativa.md) | 44 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/quarto-parecer-bateria-2026-09-18.md](../docs/quarto-parecer-bateria-2026-09-18.md) | 63 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/quinto-parecer-bateria-2026-09-18.md](../docs/quinto-parecer-bateria-2026-09-18.md) | 64 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/replica-parecer-r1-r10-2026-09-24.md](../docs/replica-parecer-r1-r10-2026-09-24.md) | 76 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/resultados-revalidacao-e2e-2026-09-17.json](../docs/resultados-revalidacao-e2e-2026-09-17.json) | 1 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/resultados-revisao-diagnostico-e2e-2026-09-17.json](../docs/resultados-revisao-diagnostico-e2e-2026-09-17.json) | 1 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/resultados-revisao-e2e-120ms.json](../docs/resultados-revisao-e2e-120ms.json) | 1 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/resultados-suite-completa.json](../docs/resultados-suite-completa.json) | 1 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/resultados-testes-pendencias-js.json](../docs/resultados-testes-pendencias-js.json) | 1 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/resultados-testes-revisao.json](../docs/resultados-testes-revisao.json) | 1 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/revalidacao-diagnostico-e2e-172ms-2026-09-17.md](../docs/revalidacao-diagnostico-e2e-172ms-2026-09-17.md) | 89 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/revalidacao-pendencias-2026-09-15.md](../docs/revalidacao-pendencias-2026-09-15.md) | 172 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/revalidacao-r1-r10-2026-09-24.md](../docs/revalidacao-r1-r10-2026-09-24.md) | 56 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/revisao-completa-codigo-2026-09-24.md](../docs/revisao-completa-codigo-2026-09-24.md) | 141 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/revisao-diagnostico-e2e-2026-09-17.md](../docs/revisao-diagnostico-e2e-2026-09-17.md) | 70 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/revisao-projeto-2026-09-16.md](../docs/revisao-projeto-2026-09-16.md) | 119 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/revisao-resultados-e2e-direto-2026-09-17.md](../docs/revisao-resultados-e2e-direto-2026-09-17.md) | 115 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/revisao-rodada-0005-e2e-2026-09-18.md](../docs/revisao-rodada-0005-e2e-2026-09-18.md) | 96 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/segundo-parecer-isolamento-2026-09-18.md](../docs/segundo-parecer-isolamento-2026-09-18.md) | 86 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/setimo-parecer-causas-stutters-2026-09-19.md](../docs/setimo-parecer-causas-stutters-2026-09-19.md) | 53 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/sexto-parecer-bateria-2026-09-18.md](../docs/sexto-parecer-bateria-2026-09-18.md) | 73 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/snapshot-planejamento-2026-09-16.json](../docs/snapshot-planejamento-2026-09-16.json) | 77 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/terceiro-parecer-bateria-2026-09-18.md](../docs/terceiro-parecer-bateria-2026-09-18.md) | 79 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/testes-pendencias.md](../docs/testes-pendencias.md) | 93 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/testes-revisao-e2e.md](../docs/testes-revisao-e2e.md) | 80 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |
| [docs/verificacao-implementacao-2026-09-14.md](../docs/verificacao-implementacao-2026-09-14.md) | 192 | Histórico datado/resultado experimental: preservar rastreabilidade; confrontar com arquitetura e validações atuais; não usar como prova desta execução. |

## Assets (22)

| Arquivo | Linhas | Encaminhamento |
| --- | ---: | --- |
| [css/assets/co-op-adventure.webp](../css/assets/co-op-adventure.webp) | binário | Asset de interface/fixture; inventariado por hash. Dono da feature ou pipeline de geração; sem refatoração de lógica interna. |
| [css/assets/gamepad.glb](../css/assets/gamepad.glb) | binário | Asset de interface/fixture; inventariado por hash. Dono da feature ou pipeline de geração; sem refatoração de lógica interna. |
| [css/assets/portal-logo-arch.jpg](../css/assets/portal-logo-arch.jpg) | binário | Asset de interface/fixture; inventariado por hash. Dono da feature ou pipeline de geração; sem refatoração de lógica interna. |
| [css/assets/portal-logo-ring.jpg](../css/assets/portal-logo-ring.jpg) | binário | Asset de interface/fixture; inventariado por hash. Dono da feature ou pipeline de geração; sem refatoração de lógica interna. |
| [css/assets/portal-logo-ring.png](../css/assets/portal-logo-ring.png) | binário | Asset de interface/fixture; inventariado por hash. Dono da feature ou pipeline de geração; sem refatoração de lógica interna. |
| [css/assets/seemygame-portal.svg](../css/assets/seemygame-portal.svg) | 25 | Asset de interface/fixture; inventariado por hash. Dono da feature ou pipeline de geração; sem refatoração de lógica interna. |
| [src-tauri/icons/128x128.png](../src-tauri/icons/128x128.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/128x128@2x.png](../src-tauri/icons/128x128@2x.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/32x32.png](../src-tauri/icons/32x32.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/Square107x107Logo.png](../src-tauri/icons/Square107x107Logo.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/Square142x142Logo.png](../src-tauri/icons/Square142x142Logo.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/Square150x150Logo.png](../src-tauri/icons/Square150x150Logo.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/Square284x284Logo.png](../src-tauri/icons/Square284x284Logo.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/Square30x30Logo.png](../src-tauri/icons/Square30x30Logo.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/Square310x310Logo.png](../src-tauri/icons/Square310x310Logo.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/Square44x44Logo.png](../src-tauri/icons/Square44x44Logo.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/Square71x71Logo.png](../src-tauri/icons/Square71x71Logo.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/Square89x89Logo.png](../src-tauri/icons/Square89x89Logo.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/StoreLogo.png](../src-tauri/icons/StoreLogo.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/icon.icns](../src-tauri/icons/icon.icns) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/icon.ico](../src-tauri/icons/icon.ico) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |
| [src-tauri/icons/icon.png](../src-tauri/icons/icon.png) | binário | Asset de ícone/packaging; inventariado por hash, sem modularização de lógica. |

## Configuração, API e documentação vigente (15)

| Arquivo | Linhas | Encaminhamento |
| --- | ---: | --- |
| [.cargo/config.toml](../.cargo/config.toml) | 10 | M18: configuração do SDK de desenvolvimento, distinta de runtime; manter provisioning explícito. |
| [.gitignore](../.gitignore) | 12 | Manter artefatos, dependências e runtime ignorados; documentar diferença entre source e output. |
| [README.md](../README.md) | 123 | M18: corrigir comandos native inexistentes e adicionar arquitetura/setup vigentes; links para histórico. |
| [api/turn.js](../api/turn.js) | 160 | M18: endpoint coeso; política/provider separáveis se justificar reuso e teste; contrato de resposta canônico. |
| [native-media/README.md](../native-media/README.md) | 37 | M18: alinhar provisioning runtime/SDK com package.json; documentação vigente de recursos de packaging. |
| [package-lock.json](../package-lock.json) | 1872 | Lockfile gerado: preservar consistência com manifesto; nunca modularizar manualmente. |
| [package.json](../package.json) | 38 | M18/M16: comandos/gates reais por escopo; scripts native/documentação e smoke ESM coerentes. |
| [src-tauri/.gitignore](../src-tauri/.gitignore) | 4 | Manter produtos locais/gerados fora da revisão de source. |
| [src-tauri/Cargo.lock](../src-tauri/Cargo.lock) | 4948 | Lockfile gerado: preservar dependências/versionamento; não decompor manualmente. |
| [src-tauri/Cargo.toml](../src-tauri/Cargo.toml) | 42 | M15/M18: submódulos no crate atual primeiro; nenhum novo crate requerido por esta auditoria. |
| [src-tauri/build.rs](../src-tauri/build.rs) | 60 | M18: packaging de DLLs/runtime com contrato canônico de manifesto; tests/check/build distintos. |
| [src-tauri/capabilities/default.json](../src-tauri/capabilities/default.json) | 11 | Configuração de permissões: revisar junto com mudanças de commands/adapters pertinentes, sem dividir por tamanho. |
| [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) | 58 | M18: build/resources/capabilities e páginas alinhados à estratégia de templates e entrypoints. |
| [src-tauri/windows/hooks.nsh](../src-tauri/windows/hooks.nsh) | 37 | M18: lista de DLLs deve concordar com runtime/build manifest; lógica de instalador isolada do engine. |
| [vitest.config.js](../vitest.config.js) | 10 | M16/M17: projetos/fixtures por ambiente se útil; smoke de linking nativo/páginas é gate separado do transformador. |

