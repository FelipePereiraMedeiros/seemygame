# Auditoria de modularização e colaboração — SeeMyGame

**Data:** 30/09/2026. **Base:** `dev`, acompanhando `FelipePereiraMedeiros/seemygame:dev`, commit `b530e17ac37f4c86dba91f288235cb7703ac3dfa`.

## Conclusão

A direção iniciada é boa, mas a migração ainda mantém duas implementações concorrentes. Criaram-se um kernel, wrappers de plugins e novos entrypoints; o aplicativo antigo continua com a composição, o estado, a interface e a rede concentrados em `js/app.js`. Alguns entrypoints usam contratos diferentes dos módulos reais e um import inválido impede a vinculação nativa de módulos.

Para facilitar o trabalho de Diogo e Felipe, a prioridade é **estabelecer contratos e um único ciclo de vida por página e sessão**, depois extrair funcionalidades completas. Apenas mover blocos para pastas continuará exigindo que os dois alterem o mesmo estado e a mesma inicialização.

Não foram alterados módulos de produto nesta auditoria. Os documentos registram achados, alternativas e um plano de PRs; não representam refatorações já implementadas.

## Escopo, método e evidência

Foram inventariados **todos os 260 arquivos rastreados no commit-base**. Todos foram lidos pelo inventariador e receberam hash SHA-256. A análise estática examinou os 149 arquivos JS/MJS por AST, imports relativos e reexports, funções/métodos, efeitos executáveis no topo, acesso ao DOM, gravações em globais e referências entre arquivos. HTML, CSS, Rust, Python, PowerShell, configurações, documentação, lockfiles e assets foram classificados. A leitura aprofundada concentrou-se nas fronteiras e fluxos do código autoral; ler/hash de um asset ou inventariar um relatório histórico não equivale a validar seu conteúdo visual ou seu resultado experimental.

Os diretórios ignorados `node_modules`, `dist`, `coverage`, `output`, SDK/runtime nativo e `src-tauri/target` são dependências ou resultados locais, não arquivos de produto a modularizar. `dist` foi reconstruído como verificação. Arquivos locais não rastreados não integram o inventário do commit.

- [Inventário por arquivo, com encaminhamento](inventario-modularizacao-2026-09-30.md).
- [Inventário estruturado, métricas e hashes](inventario-modularizacao-2026-09-30.json).
- Relatório bruto desta execução Vitest: `output/modularization-tests-2026-09-30.json`, ignorado pelo Git.

| Grupo | Arquivos | Linhas físicas |
| --- | ---: | ---: |
| JavaScript autoral do frontend | 45 | 22.590 |
| Rust em `src-tauri/src` | 9 | 5.828 |
| CSS | 9 | 5.627 |
| Testes, fixtures e suporte em `tests` | 83 | 19.204 |
| Ferramentas em `tools` | 18 | 5.166 |
| Documentação e resultados históricos em `docs` | 44 | 4.031 |
| HTML, API, configuração, manifestos e lockfiles | 22 | 10.910 |
| Vendor JavaScript | 7 | 92.843 |
| Assets binários e SVG | 23 | 25 linhas de SVG |

Contagens de linhas incluem comentários e testes embutidos. JSON em uma linha tem poucas linhas e pode ter muitos bytes. Tamanho ajuda a localizar concentração de responsabilidades; não define sozinho a necessidade de separar um módulo. O grafo de imports autorais resolvidos estaticamente não apresentou ciclos; isto não prova independência entre módulos, nem inclui imports construídos dinamicamente com variáveis.

## Validações executadas

| Verificação | Resultado | O que comprova |
| --- | --- | --- |
| `npm test -- --reporter=json --outputFile=output/modularization-tests-2026-09-30.json` | 636 testes aprovados em 64 arquivos | Comportamentos cobertos pela suíte Vitest atual |
| `python -B -m unittest discover -s tests -p test_pending_companion.py -v` | 5 testes aprovados | Regressões simuladas de input, slots, autenticação e failsafe do Companion |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib` | 30 testes aprovados | Contratos/pipelines cobertos, disponibilidade local do backend e negociação GStreamer exercitada pelos testes |
| `cargo check --manifest-path src-tauri/Cargo.toml --locked --offline --lib` | Aprovado | Compilação do código de produção da biblioteca Rust, incluindo trechos excluídos dos testes |
| `npm run build:dist` | Aprovado | Cópia dos assets para `dist`; não vincula imports nem testa as páginas |
| Parse AST de JS/MJS | 149 arquivos sem erro de sintaxe | Sintaxe; não garante exports ou contratos corretos |
| Parse PostCSS | 9 arquivos CSS aprovados | Sintaxe; não valida cascata nem aparência |
| Importação ESM nativa de `js/app.js` | **Falhou** | Import nomeado inexistente nos entrypoints; reproduzível fora do transformador de testes |
| Rejeição assíncrona em `MessageDispatcher` e `EventBus` | **Falha de contenção confirmada** | Handlers async rejeitam fora do `try/catch`; o dispatcher retorna `errorCount: 0` |

Não foram executados os cenários completos de navegador/desktop com pessoas em redes distintas, seleção real de janelas, áudio remoto ou TURN de homologação/produção. Os resultados acima não validam esses cenários. A suíte em JSDOM emitiu avisos de canvas e navegação não implementados; terminou aprovada.

## Achados prioritários

### M01 — P0: import inválido impede o carregamento ESM

`js/entries/viewer-entry.js:49`, `streamer-entry.js:78` e `room-entry.js:51` importam `p2pDispatcher` de `js/core/message-dispatcher.js`. Esse arquivo exporta `MessageDispatcher` e `globalDispatcher`, não `p2pDispatcher` (`:186`). A instância com esse nome está em `app.js:2015`.

`app.js:114` importa o barrel `entries/index.js`, que reexporta todos os entrypoints. Portanto, o erro é alcançável também nas páginas antigas que carregam `app.js`, não apenas quando se ativa explicitamente um novo entrypoint.

Reprodução executada: `node --input-type=module -e "await import('./js/app.js')"`. O erro observado foi `SyntaxError: The requested module '../core/message-dispatcher.js' does not provide an export named 'p2pDispatcher'`.

**Encaminhamento:** definir quem cria o dispatcher da sessão e injetá-lo nos consumidores. Um alias isolado pode desbloquear a vinculação, mas não resolve as duas instâncias e os handlers separados descritos em M04. Gate: importação ESM real e smoke de carregamento das páginas, além da suíte unitária.

### M02 — P1: novos entrypoints não preservam os contratos existentes

| Consumidor novo | Chamada encontrada | Contrato real | Consequência se o caminho for usado |
| --- | --- | --- | --- |
| `streamer-entry.js:209` | `captureProvider.startCapture(sourceId, options)` | `NativeCaptureProvider.start(options)` em `capture.js:123`; retorna `{stream, session, operationId}` | Método inexistente; mesmo ajustar o nome exige tratar retorno, configuração e unidades |
| `streamer-entry.js:234`, `viewer-entry.js:196` | `addOrUpdateVideoCard(id, stream, options)` | Um objeto `{stream, peerId, label, isLocal, ...}` em `ui.js:361` | Cartão não recebe os parâmetros esperados |
| `viewer-entry.js:204` | `startStatsMonitor(pc, callback)` | `(peerId, pc, isLocal, onTelemetry)` em `stats.js:17` | Monitor recebe conexão/callback em posições erradas; HUD espera `rttMs/bitrateKbps/packetLossRatio`, enquanto o módulo fornece `rtt/bitrateMbps/packetLossRate` |
| `viewer-entry.js:214` | `stopStatsMonitor()` | `stopStatsMonitor(peerId)` em `stats.js:248` | Não encerra o monitor associado ao host correto |
| `room-entry.js:164` | `new RoomManager(peer, roomId, userName, {pin})` | Um objeto `{roomId, userName, clientSessionId, roomPin, roomKey, ...}` em `room.js:78` | Sala, identidade e autorização não configuradas como pretendido |
| `room-entry.js:190` | `rm.join()` | `join(peerId, isMaster)` em `room.js:162` | Retorna `false` sem peerId; o entrypoint ainda anuncia ingresso |
| `room-entry.js:170` | `new RelayManager(peer, {maxDirectViewers: 8})` | Um objeto de opções em `relay.js:20` | Segundo argumento ignorado; origem/limites não configurados como pretendido |
| `room-entry.js:176` | `voiceManager.init(peer)` | Não existe `init` em `VoiceManager`; entrada é `joinVoice(options)` em `voice.js:75` | Método inexistente |
| `room-entry.js:181` | `new DiscordUIController({chatManager, voiceManager, roomManager})` | Construtor recebe callbacks `onSendMessage`, `onJoinVoice`, etc., em `discord-ui.js:21` | Dependências enviadas não ligam as ações da UI |
| `streamer-entry.js:342` | Prompt Co-op com dois argumentos e `promptOptions` | Handler recebe um objeto `{senderPeerId, approve, deny, ...}`; modal usa `(requesterId, onApprove, onDeny)` | Contrato de aprovação não preservado |

O novo streamer ainda não reproduz a autenticação/admissão antes de entregar mídia: `handleViewerConnection` chama o viewer no `open`, enquanto a implementação antiga possui gates explícitos de PIN. Também não tem paridade com a sinalização nativa direta, reconexão, sincronização inicial de recursos ou salas multi-stream. Estes caminhos precisam de testes de comportamento antes de substituir a implementação existente.

**Encaminhamento:** extrair os fluxos existentes já testados e corrigir suas interfaces; evitar manter uma segunda implementação simplificada como substituta. Preservar PIN, `roomKey`, identidade da sessão, cancelamento e late-joiner em cada PR.

### M03 — P1: inicialização por efeito de import e caminhos duplicados

- `room.html:1096`, `streamer.html:719` e `viewer.html:537` continuam com `src="js/app.js"`.
- Os entrypoints importados pelo barrel também se auto-inicializam ao reconhecer o pathname.
- `app.js:2086` chama `initPlugins()` durante a importação.
- `app.js:5632` chama controles e recursos gamer; `initAppDom`, em `:5641`, repete essa inicialização. Existe ainda `bootstrapApp` em `:6091`, além dos scripts de termos no HTML.
- `lobby.html:144` e `:271` mantêm implementações inline paralelas ao `lobby-entry.js`.

Corrigido M01, esses caminhos concorrentes precisam ser resolvidos: podem criar peers, callbacks e listeners em duplicidade. Algumas funções já usam `AbortController`; isso não torna toda a inicialização idempotente.

**Encaminhamento:** cada página carrega exatamente um entrypoint. Importar classes, contratos ou fachadas não inicia sessão, DOM ou rede. O entrypoint monta os serviços uma vez e retorna `dispose()`; barreiras de consentimento e Green Room pertencem a esse fluxo. O barrel deve ter exports explícitos: os `export *` atuais também juntam nomes concorrentes como `isHost`.

### M04 — P1: composição e estado ainda têm duas fontes de verdade

O core exporta `globalDispatcher` e um `pluginManager` sem contexto. `app.js` cria outro dispatcher e outro `PluginManager` (`:2015`, `:2070`). Os entrypoints usam o manager do core, mas passam `p2pDispatcher` ao `initAll`; os plugins leem `context.dispatcher`. Não fornecem os mesmos callbacks de broadcast e ambiente da implementação antiga.

Os mesmos singletons `whiteboardPlugin`, `soundboardPlugin`, etc., são registrados em managers distintos. `BasePlugin.init` retorna quando `enabled` já está ativo; assim, a primeira inicialização conserva seu contexto. `viewerState`, `streamerState`, `roomState` e os mapas de `app.js` também são estados separados.

**Encaminhamento:** uma fábrica `createSessionContext` cria bus, dispatcher, serviços e instâncias de plugins por sessão. O composition root é o único ponto que monta dependências. Injetar portas pequenas por funcionalidade, sem transformar o contexto em um objeto global com todos os detalhes internos. Singletons podem permanecer provisoriamente atrás de fachadas, com proprietário explícito e migração gradual.

### M05 — P1: `app.js` continua sendo o principal ponto de conflito entre os dois

São **6.155 linhas**, aproximadamente **27,2%** do JS autoral, com 28 imports/reexports de origem registrados, 100 nomes exportados, 189 chamadas diretas a `document` e 35 blocos executáveis no topo identificados pelo inventariador. Vinte e um arquivos de teste importam diretamente o módulo. Estes números descrevem o snapshot, não uma meta de redução arbitrária.

| Bloco atual e referência | Destino proposto | Contrato para preservar |
| --- | --- | --- |
| URL/identidade/PIN (`:168`, `:489`, `:540`, `:592`) | `session/identity.js`, `session/admission.js`, `navigation/room-links.js` | Separar parsing, storage, autorização e apresentação do prompt |
| Qualidade, bitrate e áudio (`:264`, `:777`, `:897`, `:1024`) | `media/quality-controller.js`, `media/audio-routing.js`, UI de tuning | Estado em bps/kbps com conversão na borda; reconfiguração serializada |
| Recarregamento e encerramento (`:1257`, `:1279`) | `session/lifecycle.js`, componente de confirmação | Cancelar retries, peers, captura e listeners uma vez |
| Peer e sessão de sala (`:1437`, `:1668`) | `network/peer-session.js`, `room/room-session.js` | TURN antes de Peer, retry de ID, eleição, admissão e reconexão |
| Broadcast e voz (`:1937`, `:1964`, `:2230`) | `network/data-transport.js`, `voice/voice-session.js`, composition root | Broadcast somente a admitidos; tipo e autoria da chamada |
| Dados/PIN/relay (`:2503`) | Handlers de protocolo por domínio | Admissão precede handlers funcionais e entrega de mídia |
| Sinalização direta (`:2801`, `:2820`, `:2990`, `:3145`) | `media/native-signaling.js` | Filas ICE, offers concorrentes, teardown e identidade do host |
| Chamada/envio/recepção (`:3167`, `:3335`, `:3513`, `:3697`) | `media/publisher.js`, `media/subscriber.js`, `media/call-registry.js` | Late-joiner, cancelamento, autenticação e limpeza por host |
| Captura e seletor (`:3771`, `:4016`, `:4098`) | `capture/capture-session.js`, UI de source-picker | Operações obsoletas não derrubam sessão nova; fallback explícito |
| Facecam/Ping/Reações/ABR (`:4420`, `:4476`, `:4611`, `:4649`) | Features com UI e ciclo de vida próprios | Recursos pertencem à sessão e ao host corretos |
| Editor do clip (`:4761`, 374 linhas) | `features/clipping/editor-controller.js` | Blob, preview, recorte, efeito, playback e URL de objeto |
| UI da lousa (`:5140`, 411 linhas) | `features/whiteboard/controller.js` | Toolbar/modal/input; engine e sincronização ficam separados |
| Green Room (`:5751`, 339 linhas) | `features/green-room/controller.js` | Prévia, seleção de devices, mute, watcher e consentimento |
| Termos/boot (`:5641`, `:6091`) | `features/terms/controller.js`, `entries/*` | Uma versão canônica de consentimento e uma inicialização |

Não mover todo o estado para `state.js` e continuar mutando-o de qualquer pasta. Cada domínio deve controlar o estado que possui e oferecer comandos, eventos e snapshots definidos.

### M06 — P1: regras de domínio importam o agregador de interface

`room.js:8` e `voice.js:6` importam `isValidPeerId` de `ui.js`, que também importa áudio, stats e config. `room-codes.js` importa `room.js` só para obter sanitização, levando o lobby a depender de um caminho desnecessário até a UI/media.

**Encaminhamento:** extrair `shared/peer-id.js`, `room/room-id.js` e regras de texto/limites com funções puras. Modelos de sala e voz não dependem de DOM. Há sanitização semelhante em `chat.js` e `room.js`, mas consolidar só após comparar os contratos: escape de apresentação e validação de domínio são responsabilidades distintas.

### M07 — P1: protocolo e admissão não estão definidos como uma fronteira única

Tipos de mensagens e payloads aparecem como strings em `app.js`, `room.js`, `coop.js`, plugins e testes. `setupIncomingDataConnection` mistura autenticação, sinalização, relay, voz, mídia e recursos gamer. `RoomManager.handleRoomMessage` concentra 400 linhas. A deduplicação também existe tanto em `app.js` quanto no dispatcher, com políticas e capacidades diferentes.

**Encaminhamento:** definir mensagens e validação por domínio em `protocol`, com envelope de transporte e contexto de origem admitida. Separar handlers de admissão, presença, mídia, voz, Co-op e features. Reutilizar a mesma política de broadcast autorizado e deduplicação; não deduplicar mensagens distintas somente por ID de entidade. Manter compatibilidade no fio durante os PRs e documentar unidades, identidade, sessão, limites e erros. JSDoc/`@typedef` já atende a essa primeira etapa; uma migração global de linguagem não é pré-requisito.

### M08 — P1: isolamento de falhas assíncronas incompleto

`EventBus.emit` (`core/event-bus.js:77`) e `MessageDispatcher.dispatch` (`core/message-dispatcher.js:110`) chamam handlers dentro de `try/catch`, mas não tratam Promises rejeitadas. O dispatcher documenta handlers que retornam `Promise<void>`.

A reprodução executada registrou um handler async que lança erro e outro que termina. O segundo rodou, porém a rejeição virou `unhandledRejection`, o resultado marcou `handled: true, errorCount: 0` e as métricas mantiveram zero erros. O bus teve comportamento equivalente. Os testes atuais de isolamento exercitam exceção síncrona.

**Encaminhamento:** definir explicitamente API síncrona e assíncrona. Se o retorno continuar síncrono, capturar e reportar rejeições com métricas/evento posteriores; se o contrato for async, aguardar e manter ordem/isolamento conforme a necessidade. Evitar mudar silenciosamente todos os consumidores para `await`. O comentário que chama o bus de circuit breaker não descreve um mecanismo de abertura/fechamento de circuito existente.

### M09 — P1: ciclo de vida não acompanha toda a funcionalidade

`handlePageUnload` em `app.js:1257` encerra sala/peer, mas não chama `pluginManager.destroyAll`. `DiscordUIController` registra listeners DOM, chat, voz e soundboard sem uma operação de destruição correspondente. O manager da lousa instala eventos no canvas e nos globais; seu plugin remove handlers de rede e callbacks, mas não desmonta a implementação inteira de input/render.

**Encaminhamento:** adotar `init/mount` + `dispose/unmount` por componente, com funções de unsubscribe e um escopo de recursos para listeners, timers, RAF, observers, object URLs, tracks e nós de áudio. O dono de uma track/contexto fecha o recurso; consumidores desligam apenas suas conexões. Testar montar/desmontar/montar e duas instâncias independentes. Não afirmar vazamento em produção apenas pelo tamanho do arquivo: a lacuna confirmada é a ausência de um contrato completo de desmontagem.

### M10 — P1: plugins encapsulam parte da rede, enquanto a UI permanece fora

`WhiteboardPlugin`, `SoundboardPlugin`, `TacticalPingPlugin` e `ReactionsPlugin` avançaram o registro/desregistro de mensagens. Contudo, boa parte da UI e emissão de ações permanece em `app.js` e `discord-ui.js`. `ClippingPlugin` escuta `stream:started/stopped`; o fluxo antigo continua com chamadas diretas a `clipRecorder.start/stop` por fonte. Os eventos de stream desses nomes são emitidos nos entrypoints novos, não no fluxo antigo de captura.

O plugin de clipping documenta `exportClip(durationSeconds)`, mas a instância padrão é `ClipRecorderRegistry`, cuja assinatura é `exportClip(customFilename, sourceId)` (`clipping.js:728`). Também perde a seleção explícita por fonte quando usa `start(stream)` e `stop()`.

**Encaminhamento:** cada feature reúne modelo/engine, handler de protocolo, controller/view e CSS; o composition root registra a feature. Definir um evento de stream com `sourceId`, `hostId`, `stream` e papel da sessão, e preservar a registry multi-stream. Plugin não é um segundo manager paralelo nem precisa receber acesso a toda a rede.

### M11 — P2: pool de áudio ainda não centraliza a política de recursos

O novo pool existe, mas `audio.js`, `audio-meme.js`, `soundboard.js`, `ping.js`, `clipping.js` e `audio-devices.js` continuam criando contextos próprios. O pool é usado efetivamente pelo caminho de meme remoto em `SoundboardPlugin`, além de ser reexportado por `app.js`.

**Encaminhamento:** explicitar uma porta de contexto/saída de áudio e injetá-la em VU, voz, efeitos e soundboard. Não substituir cegamente todo contexto por um singleton: recorder/mixer e teste de saída podem exigir propriedade e seleção de sink específicas. Estabelecer política compartilhada de resume, device change, volume, ownership e encerramento. Preservar separação de microfone processado e áudio de jogo sem APM.

### M12 — P2: grandes engines e agregadores têm cortes internos claros

| Arquivo | Separações úteis | O que manter unido |
| --- | --- | --- |
| `coop.js` — 1.583 linhas | Estado/slots; handlers host/viewer; transporte Companion/Tauri/browser; mapping; input; tester UI | Revogação/reset/failsafe e autorização com o mesmo contrato |
| `ui.js` — 965 linhas | Toasts; termos; card de vídeo; fullscreen/PiP; HUD/controles; prompt Co-op | Estrutura e controles de cada card no mesmo componente |
| `addOrUpdateVideoCard` — 530 linhas | Montagem, atualização de mídia e bind/desmontagem de controles | Contrato público de criação/update e limpeza de VU/stats |
| `discord-ui.js` — 1.202 linhas | Shell drawer; chat panel; voice panel; soundboard panel; presença; stage/dock | Um shell proprietário dos subcontrollers |
| `voice.js` — 920 linhas | Estado de participantes; captura/devices; mixer/volume; VAD; reprodução; sessão de chamadas fora do engine | Ownership de stream e nós; API de estado observável |
| `room.js` — 919 linhas | Estado/admissão; presença/heartbeat; handlers; anúncio de streams | Identidade, eleição e autorização como invariantes da sessão |
| `whiteboard.js` — 1.301 linhas | Documento/commands/history; geometria/hit-test; render; input; imagens; sync no plugin | Aplicação de validação em todas as operações públicas |
| `clipping.js` — 756 linhas | Recorder por fonte; buffer/flush; mixer; exporter; registry | Inicialização WebM, geração de gravação e isolamento de tracks |
| `gamepad-3d-viewer.js` — 993 linhas | Loader/modelo, materiais, mapping visual, renderer/lifecycle | Teardown completo de geometria/material/textura/RAF |
| `gamepad-model-builder.js` — 525 linhas | Componentes de geometria por peça, se houver edição simultânea | Builder e geração do GLB sob uma única versão |
| `webrtc.js` — 452 linhas | SDP puro, tuning de senders/receivers e substituição de áudio | Aplicação coerente das otimizações ao mesmo PC |
| `stats.js` — 256 linhas | Coleta; deltas/cálculo; apresentação do HUD | Estado por peer e encerramento do monitor |

`abr.js`, `relay.js`, `browser-capture.js`, `reactions.js`, `qrcode-light.js` e `room-codes.js` já possuem focos razoáveis. Corrigir suas dependências/contratos vale mais que pulverizar cada função em um arquivo.

### M13 — P1/P2: CSS modular, mas extração por linhas não pode continuar

`css/player.css` já funciona como entrada de oito linhas. Os blocos de `discord-drawer.css` (1.444 linhas) e `modals.css` (990) ainda agrupam vários domínios. `main.css` mistura tokens, reset, layout, forms e modais; `landing.css` mistura landing/lobby, enquanto `landing-premium.css` tem escopo específico bem explícito.

**P1:** `tools/split-css.mjs` lê `player.css` e corta faixas fixas da antiga versão de milhares de linhas. Reexecutá-lo sobre a entrada atual sobrescreveria os componentes com recortes inadequados. Não foi executado. Arquivar essa migração como operação única, ou exigir input/hash original e falhar antes de escrever quando a entrada não corresponde.

**P2:** separar tokens/base/layout; drawer, chat, voz e soundboard; modais por feature; layout de sala/lobby/landing. CSS e controller de uma feature devem ser revisados no mesmo PR. Preservar ordem da cascata e regras responsivas antes de dividir: os nove parses aprovados não comprovam equivalência visual. Evitar um corte por linha que mova overrides fora da ordem original.

### M14 — P1/P2: HTML tem comportamento duplicado e risco de perder identidade

Os scripts inline de termos se repetem nas páginas. O lobby implementa geração de chave e preservação de `roomKey`/base path em `lobby.html:144`; `lobby-entry.js:104` navega apenas com roomId e usa caminho a partir da raiz, perdendo esses comportamentos. `room-entry.js:78` lê roomId/PIN, mas não a chave presente no parsing legado de `app.js:168`.

**P1:** preservar chave, hash/query, PIN e caminhos de subdiretório em um serviço canônico de links. Uma migração que abra a sala errada ou abandone a chave não é uma extração equivalente.

**P2:** extrair scripts inline para entrypoints/controllers. Reutilizar marcação de termos, chat/voz, seletor, clipping e lousa com uma estratégia única de templates. Como hoje o build apenas copia arquivos, introduzir templates exige geração de HTML compartilhada no fluxo web e desktop; não presumir que uma inclusão de HTML funciona por si só. Não adicionar um framework de interface só para eliminar repetição.

### M15 — P2: Rust pode separar controle, transporte e pipeline sem novos crates

- `capture.rs` (1.301 linhas): DTOs/capabilities, comandos Tauri, sessão global, reconfiguração, monitor de saúde, fanout RTP e registro de bridges/viewers.
- `media.rs` (1.602): configuração de codecs, runtime discovery/probe, ambiente, processo/Job Object, leases UDP e construção de pipeline.
- `webrtc_bridge.rs` (838) e `native_viewer.rs` (604): inicialização GStreamer, espera de Promise, negociação e lifecycle possuem helpers parecidos, inclusive `wait_promise`.
- `windows_list.rs` (667): enumeração Win32, registro/revalidação de fontes e descoberta de processos para exclusão de áudio.
- `gamepad.rs` (618): DTOs/report mapping, adaptação Windows/fallback, registry, comandos e instalação de driver.

**Encaminhamento:** começar com submódulos dentro do crate existente. `capture/{types,session,commands,health}`, `media/{config,runtime,pipeline,worker}`, `transport/{udp,rtp_fanout}`, `webrtc/{common,capture_bridge,viewer}`, `platform/windows/{sources,audio_processes,gamepad}`. `lib.rs` fica como composition root/comandos registrados. Visibilidade `pub(crate)`/privada e DTOs estáveis evitam ampliar desnecessariamente a API.

Extrair primeiro helpers puros de configuração/pipeline; depois registry e sessão. Manter leases de portas, parada por sessão, validação de source IDs opacos, troca de áudio e renegociação em testes. DTOs normalizados em `desktop.js` precisam de exemplos/fixtures de contrato correspondentes ao Rust.

### M16 — P1: testes nativos não compilam todos os caminhos de produção

`lib.rs` e grande parte do controle em `capture.rs` têm `#[cfg(not(test))]`. Isso facilita testar media/bridge sem subir Tauri, mas os 30 testes não validam sozinhos comandos e reconfiguração de captura. O teste `native-hardening.test.js:13` ainda importa `localStream`, que não é exportado por `app.js`, outro indício de contrato não verificado por vinculação ESM.

**Encaminhamento:** manter gates distintos: testes JS, smoke real das páginas/imports, testes Rust e `cargo check` do caminho de produção. Extrair lógica de sessão das funções com `AppHandle` para permitir testar o comportamento de controle com emissores/adapters, sem excluir justamente a lógica que mais mudará.

### M17 — P2: infraestrutura E2E também concentra trabalho e se repete

Há testes `.mjs` fora do `npm test` e scripts de bancada em `tools/e2e`. `run.mjs` tem 913 linhas e `test-deterministic-battery.mjs`, 1.597. Vários cenários repetem servidor estático, provisionamento de browsers/peers, geração de stream, waits, logs e cleanup. `telemetry.mjs` tem 775 linhas e combina instalação no browser, coleta, cálculo e budgets. `optical.mjs` já é um bom módulo de cálculo; a rotina injetada no navegador também contém decodificação/CRC, cujo compartilhamento precisa respeitar a serialização de `page.evaluate`.

**Encaminhamento:** criar harness com servidor, fixture de PeerJS, synthetic-media, browser/desktop driver, waits, telemetry/report e cleanup. Os cenários ficam pequenos e declaram o comportamento esperado. Receber base URL e parâmetros explicitamente; o teste `e2e-vercel-live.mjs` aponta para produção e deve ficar separado dos gates automáticos de `dev`.

O harness depende hoje de `window.getPeer`, `window.roomManager` e outras exposições em `app.js`; migrar para uma interface de diagnóstico explícita antes de apagar essas globais. Arquivos `pending`, `review`, `audit` e `R01/L03` guardam regressões importantes, mas podem ser agrupados por domínio com rastreabilidade dos casos originais, sem apenas duplicar testes.

### M18 — P2: build/configuração/documentação precisam de uma fonte canônica

- `package.json` não possui `native:prepare` ou `native:smoke`, embora README e documentos mandem executar esses scripts.
- `desktop.js` agrega comandos de captura, viewer, gamepad e janela: extrair `platform/tauri/invoke`, `capture`, `gamepad`, `window` e `events` atrás de fachada estável.
- `config.js` mistura origem pública, descoberta/cache de TURN, perfis de qualidade e constantes de produto. Dividir por domínio e ambiente, preservando tokens somente em runtime e configuração específica de homologação.
- `api/turn.js` (160 linhas) já é relativamente coeso. Separar política de acesso/rate-limit e provider se isso facilitar testes/reuso; não transformar um endpoint pequeno em um conjunto de abstrações sem demanda.
- O servidor local apenas serve arquivos; ele não executa a função Vercel `/api/turn`. Um contrato compartilhado de desenvolvimento precisa deixar isso explícito.
- Os históricos em `docs` registram versões antigas, contagens antigas e passos por vezes divergentes. Manter como histórico e adicionar documentação vigente de arquitetura, contratos, setup e teste.
- `js/vendor/GLTFLoader.js` tem imports relativos para `js/utils/*` inexistentes. O caminho ativo mapeado em `room.html` é `js/vendor/loaders/GLTFLoader.js`, não esse arquivo da raiz. Catalogar versão/licença e remover duplicata só após confirmar consumidores e comparação; não refatorar código de terceiros como código autoral.

## Arquitetura proposta e regras de dependência

```text
HTML por página → entrypoint → composition root da sessão
                                 ├─ modelos e serviços por domínio
                                 ├─ adapters Browser / Tauri / Companion
                                 ├─ transporte e protocolo
                                 └─ controllers/views/plugins por feature

shared e modelos puros ← serviços ← controllers
                               adapters entram por portas injetadas
```

```text
js/
  entries/          lobby, room, streamer, viewer; somente montagem/boot
  core/             eventos, dispatcher, lifecycle e composição
  shared/           validação, IDs e funções puras realmente comuns
  navigation/       links, hash/query e base path
  session/          identidade, consentimento, admissão, encerramento
  protocol/         contratos/envelopes e handlers por domínio
  network/          adapter PeerJS, transporte e reconexão
  capture/          providers, state machine e sessão de captura
  media/            publisher/subscriber, chamadas, signaling, qualidade
  audio/            contextos, devices, VU e routing
  room/             estado, presença, eleição e sessão
  features/
    chat/ voice/ coop/ clipping/ whiteboard/ soundboard/
    reactions/ ping/ facecam/ green-room/ terms/
  ui/               primitivas de apresentação compartilhadas
  platform/         adapters tauri, browser e companion
  vendor/           terceiros versionados, isolados da refatoração
```

Esta é uma organização alvo, não uma exigência de criar todas as pastas vazias agora. Features pequenas podem permanecer em um arquivo. Extrações começam onde permitem editar/testar um domínio sem mexer em outro.

Regras:

1. Modelo/protocolo não importa controller, DOM ou `app.js`.
2. Controller não conhece strings de comandos Tauri; usa adapter/porta.
3. Entry monta; importar módulo não inicia aplicativo.
4. Instância e recursos têm dono; contextos por sessão evitam estado compartilhado acidental.
5. APIs públicas expõem comandos/snapshots; não mapas mutáveis como mecanismo normal de integração.
6. Cada evento/mensagem documenta payload, origem, destino, unidades e limites.
7. A fachada antiga permanece somente para compatibilidade durante a migração, sem duplicar algoritmo.
8. Nomes de arquivos por responsabilidade; evitar novos agregadores genéricos `utils.js`, `helpers.js` ou `manager.js` que concentrem o projeto novamente.

## Sequência de PRs para trabalho conjunto

| Ordem | Escopo revisável | Dependência | Critério de conclusão |
| --- | --- | --- | --- |
| 0 | Corrigir ESM/exports, contratos dos entrypoints e estabelecer smoke de boot | Nenhuma | Páginas carregam sem erro de módulos; contratos reais exercitados; aprovação da suíte não mascara linking |
| 1 | Definir composição da sessão e iniciar apenas um caminho por página | PR 0 | Um peer/fluxo de consentimento/Green Room; init-dispose-init sem duplicação; paridade dos fluxos antigos |
| 2 | Extrair IDs, links, storage e contrato de protocolo/admissão | PR 1 | Chave/PIN preservados; testes de salas separadas e origem de mensagens; modelo sem imports UI |
| 3A | Extração vertical de lousa: controller/UI/sync/engine | PR 2 | Toolbar + sync + undo/redo/imagens funcionando sem alterar composição fora do registro |
| 3B | Extração vertical de clipping/soundboard/editor | PR 2 | Gravação por fonte, teardown e replay preservados; export e duration com contrato coerente |
| 4A | Capture session, publisher/subscriber, signaling e tuning | PRs 1–2 | Late-joiner, reconexão, cancelamento, troca áudio/bitrate e chamada nativa com paridade |
| 4B | Drawer/chat/voz/Green Room e componentes CSS/HTML correspondentes | PRs 1–2 | Controllers desmontáveis; UI de voz/device e sala preservadas; revisão visual |
| 5A | Submódulos Rust config/runtime/pipeline, depois sessão/fanout | API IPC acordada no PR 2 | Testes nativos + check de produção + cenários reais pertinentes |
| 5B | Harness E2E, organização de testes e docs de colaboração | PRs 0–2 | Cenários pequenos, URL configurável, fixture/cleanup compartilhados |
| 6 | Remover fachadas/globais antigas e migrações de uso único | Extrações anteriores | Nenhum consumidor restante; todos os entrypoints e diagnósticos usam APIs finais |

3A/3B, 4A/4B e 5A/5B são **frentes que os dois podem executar em branches distintas** depois de acordar os contratos. Não significam uso de subagentes nem atividades paralelas já executadas. Não devem abrir vários PRs que recortam o mesmo `app.js` simultaneamente: extrair uma base comum primeiro ou coordenar uma sequência de rebase curta.

### Acordos para Diogo e Felipe

- Registrar uma matriz de ownership por área, negociada entre vocês; não há evidência nesta auditoria para atribuir permanentemente frontend ou Rust a uma pessoa.
- Em cada par de PRs, um fica com um domínio completo e o outro com outro, incluindo seus testes e CSS. Alterações no composition root/protocolo são pequenas e revisadas pelo outro.
- Um PR muda organização ou comportamento; quando ambos forem necessários (como nos contratos quebrados), declarar os casos de regressão e separar commits para facilitar revisão.
- Preservar fachada e assinatura existentes durante extração, até migrar todos os consumidores; evitar renomear tudo no mesmo PR que muda lógica.
- Começar a branch de trabalho em `upstream/dev`; integração em `dev`, homologação em `alpha`, candidato na `main` do Felipe e PR final para a `main` do Diogo.
- Criar `.github/CODEOWNERS`, template de PR e gates de CI após o acordo. Gate de frontend: testes + carregamento real de páginas; gate de IPC/media: acrescentar testes e check Rust. Cenários caros/Windows/TURN pertencem a uma matriz explícita de validação, não a uma promessa de que JSDOM valida captura real.
- Manter `docs/arquitetura.md`, `docs/contratos.md` e `CONTRIBUTING.md` como documentação vigente. Relatórios datados permanecem históricos.

## Aceitação da modularização

O trabalho estará facilitando colaboração quando uma feature puder ser implementada e testada alterando principalmente sua pasta, seus testes e seu registro; quando mudanças de UI não exigirem editar sinalização/captura; quando um adapter nativo puder mudar sem quebrar o modelo; e quando as páginas tiverem boot e cleanup verificáveis.

Medir a tendência de concentração em `app.js`, dependências indevidas, efeitos no import, módulos com teardown, testes de contrato e conflitos entre PRs. Não impor um teto universal de linhas nem medir sucesso somente pela quantidade de arquivos novos.

**Primeira ação recomendada:** PR 0 e PR 1. A separação das features e do Rust ganha segurança e reduz conflitos depois que o carregamento, os contratos e a composição forem únicos.
