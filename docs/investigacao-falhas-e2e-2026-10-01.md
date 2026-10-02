# Investigação das falhas E2E após modularização — 01/10/2026

Esta investigação continua [a primeira bateria histórica](resultados-e2e-pos-modularizacao-2026-10-01.md). Os resultados abaixo pertencem ao checkout local com as correções descritas; não substituem os registros anteriores. Nenhuma alteração foi publicada.

## Resultado e limites

| Problema observado | Causa/evidência | Estado |
|---|---|---|
| Tauri sem vídeo e timeout ao encerrar | Primeira descoberta dos plugins GStreamer demorada, executada por comando síncrono na thread da interface | Comandos de descoberta/início deslocados para execução assíncrona; inicialização fria e encerramento passaram. O custo da descoberta continua alto |
| Fonte 720p entregue em 360p–540p | Envio de Room sem aplicar os parâmetros de transmissão; preferências dos transceivers do receptor aplicadas cedo demais | Parâmetros aplicados e negociação corrigida; 720p/H.264 observados nos três espectadores |
| Nativo também abrindo chamada de vídeo PeerJS | Caminhos diferentes para membros já presentes e entrada tardia | Envio unificado, priorizando o transporte nativo; E2E exige zero chamadas de mídia do navegador e um peer nativo |
| FPS baixo apesar de resolução corrigida | Custo de replay concorrente reproduzido, com quatro gravadores ativos na última rodada | Gargalo identificado por intervenção; otimização do produto pendente |
| Relay esperado pelo benchmark ausente | Runtime modular de Room não integra o fluxo de encaminhamento legado; limite e premissas do teste também divergem | Pendente; testes de relay continuam reprovados |

Não foram desabilitados replay ou CSP no produto. O harness usa isolamento local e adaptações de teste; portanto, não valida a configuração de serviços/CSP em produção.

## 1. Inicialização nativa

Em `src-tauri/src/media/runtime.rs`, foram adicionados tempos por descoberta de elemento. A reprodução instrumentada parou na primeira consulta de `d3d11screencapturesrc`, antes da seleção do encoder. Um probe separado reproduziu avisos/falha do helper de plugins; a causa específica dessa falha não foi identificada.

Aquecer o registro permitiu iniciar com o mesmo executável, evidenciando a sensibilidade à primeira descoberta. Em `src-tauri/src/capture/commands.rs`, `get_native_capture_capabilities` e `start_native_capture` agora usam `#[tauri::command(async)]`, para que COM/D3D/registro de plugins não ocupem a thread da WebView. A reserva da sessão ativa passou a ocorrer na mesma seção crítica que verifica se outra captura está ativa, evitando uma corrida entre inícios concorrentes.

Validação com registro GStreamer novo e isolado:

- [Relatório da inicialização fria](../output/playwright/2026-10-01T16-50-20-812Z-3c610b/report.json): primeira consulta **24.893 ms**, seleção/início **32.466 ms**, encerramento confirmado ocioso em **460 ms**; E2E aprovado.
- [Relatório com registro aquecido](../output/playwright/2026-10-01T17-08-54-172Z-246879/report.json): seleção/início **2.548 ms**, encerramento **340 ms**; E2E aprovado.

Isso corrige a execução bloqueante na interface, mas não torna a primeira inicialização rápida. O fallback externo de inspeção ainda usa espera de subprocesso sem limite explícito: merece timeout, cancelamento e diagnóstico próprio. Não há evidência para atribuir a falha do helper a uma DLL específica.

## 2. Envio e negociação da sala

`js/session/room-session.js` agora usa o mesmo caminho para espectadores já presentes e novos membros. Esse caminho verifica autorização, evita chamadas duplicadas, aplica bitrate/FPS/prioridades e registra o encerramento na sessão. Quando existe transmissão nativa, usa `broadcastTo` e evita enviar o preview por PeerJS. Também foi removido o envio nativo indevido do loop de chamadas de voz.

No receptor, as preferências de transceiver são aplicadas antes de `createAnswer`, quando os transceivers do offer já existem. Aplicar imediatamente depois de `call.answer()` não garantia esse momento, porque a negociação do PeerJS é assíncrona.

A evidência separa os efeitos:

1. Antes da correção: 960×540, 640×360 e 480×270; VP8 e ausência dos limites esperados nos encodings.
2. Só com parâmetros de sender: os limites passaram a aparecer, mas ainda havia redução de resolução e VP8.
3. Com negociação corrigida: **1280×720/H.264 nos três espectadores**, sem limitação de qualidade reportada naquele intervalo.

[Evidência da negociação corrigida](../output/playwright/historical-suite-2026-10-01T16-44-44-626Z/historical-720p-tree-benchmark-2026-10-01T16-44-44-941Z/observed-720p.json).

O fixture antigo mudava o preset, mas mantinha o slider em **7,5 Mbps**. Estes ensaios não devem ser descritos como testes de 4,5 Mbps. A resolução é verificada no receptor; selecionar 720p na interface não basta.

## 3. Replay e perda de FPS

Com fonte nominal de 60 FPS, três espectadores e transmissão 720p, desligar somente o plugin de clipping no teste alterou fortemente o resultado:

| Ensaio | Replay | FPS apresentados por espectador | FPS real da fonte |
|---|---|---|---|
| Um espectador | Ativo | 49,87 | 59,75 |
| Três espectadores | Desativado | 59,74 / 60,12 / 60,12 | 60,12 |
| Três espectadores, repetição sem compilação concorrente | Ativo | 38,62 / 40,87 / 41,25 | 55,47 |
| Três espectadores, nova repetição com MIME registrado | Ativo | 17,12 / 20,74 / 17,99 | 55,57 |
| Três espectadores, repetição seguinte sem replay | Desativado | 59,97 / 59,86 / 60,00 | 60,11 |

Evidências: [um espectador](../output/playwright/historical-720p-tree-benchmark-2026-10-01T16-54-09-794Z/observed-720p.json), [três sem replay](../output/playwright/historical-720p-tree-benchmark-2026-10-01T16-57-08-319Z/observed-720p.json), [três com replay](../output/playwright/historical-720p-tree-benchmark-2026-10-01T16-58-25-105Z/observed-720p.json), [repetição com gravadores registrados](../output/playwright/historical-720p-tree-benchmark-2026-10-01T21-25-01-074Z/observed-720p.json).

A última rodada confirmou **quatro MediaRecorders ativos**, um no host e um em cada espectador, todos em **`video/webm;codecs=vp9,opus` a 2,5 Mbps**. Não era apenas uma preferência de codec inferida do código.

A repetição seguinte, com replay desativado, voltou a aproximadamente 60 FPS nos três espectadores. [Evidência da repetição sem replay](../output/playwright/historical-720p-tree-benchmark-2026-10-01T21-31-19-509Z/observed-720p.json). São execuções consecutivas, não uma medição simultânea nem uma distribuição de várias repetições sob recursos fixados.

Todos os participantes executam na mesma máquina, portanto o resultado mede pressão agregada de captura, envio, decodificação e gravação. Não isola quanto custa o gravador do host versus cada receptor. A variação entre repetições impede afirmar um percentual fixo de penalidade ou que o replay explique todos os stutters. Ainda assim, é um candidato prioritário, sustentado por uma intervenção concreta. `qualityLimitationReason=none` não exclui essa concorrência.

`--no-replay` remove o plugin apenas no teste; o comportamento padrão do produto permanece ativo. O modo `--delivery-only` verifica mídia entregue e explicitamente não aprova relay.

## 4. Relay: código legado e runtime servido não são equivalentes

Há implementação de relay em `js/app/media-calls.js`, `message-routing.js` e `peer-session.js`. Os testes unitários legados carregam `js/app.js` com bindings de compatibilidade e podem passar sem validar a entrada modular que está servindo Room.

No caminho atual de `room-session.js`, o RelayManager tem limite de **oito espectadores diretos**, mas não está integrado ao registro/roteamento das chamadas de vídeo nem às mensagens de encaminhamento. A transmissão real abre chamadas diretas e a topologia permanece vazia. O benchmark histórico espera duas chamadas diretas e a terceira encaminhada; essa expectativa também precisa usar configuração explícita. Atualizações de RTT antes de registrar os nós são ignoradas e não justificam a topologia esperada.

Não se deve preencher topologia fictícia ou reduzir o limite de produção para obter um teste verde. A integração precisa acompanhar o **publicador de cada stream**, que pode ser diferente do coordenador da sala, e comprovar o encaminhamento real dos frames.

## 5. Próximas correções e testes prioritários

1. **Isolar o custo do replay:** mesma carga com gravação só no host, só no receptor, em ambos e desativada; repetir com ordem alternada e medir CPU/GPU/encode/FPS/pausas. Comparar codecs suportados, resoluções e cadência de gravação. Qualquer redução deve usar uma trilha separada, evitando alterar por engano a transmissão ao aplicar constraints no mesmo track. Para o nativo, avaliar armazenamento circular do vídeo já codificado, com testes de keyframe, áudio, timestamps e exportação.
2. **Limitar a descoberta nativa:** investigar o helper com registro frio, adicionar timeout/cancelamento ao subprocesso e testar início concorrente, fechamento da janela e interrupção durante a descoberta. Preservar logs por etapa.
3. **Integrar relay ao runtime atual:** protocolo autorizado por publicador, validação de origem/pai/filho, encaminhamento de tracks, entrada tardia, saída do pai, reconnect e fallback direto. O E2E deve configurar o limiar e verificar PCs reais, número de chamadas na origem e frames no filho, incluindo múltiplos publicadores e tentativas de atribuição indevida.
4. **Revalidar latência e carga:** binário release, mesma resolução efetivamente recebida, mesmo navegador receptor, várias repetições de 60–120 s e ordem alternada; depois carga de jogo, áudio e TURN. Registrar replay, codec e uso de recursos como condições do experimento.

O último comparativo Tauri/web usa receptores diferentes e entregou **1280×720 no nativo e 1282×800 no web**. Foi marcado como comparação exploratória no runner: suas diferenças de latência não isolam o método de captura. Decode/jitter do preview local também não devem ser somados automaticamente ao caminho remoto do envio nativo direto.

## 6. Validações concluídas

- Build frontend e build Rust debug offline: aprovados.
- Verificação de módulos, smoke de imports e sintaxe dos runners: aprovados.
- Suíte unitária isolada: **84 arquivos / 853 testes aprovados**. Uma execução simultânea a E2Es excedeu o prazo de um teste de criação de modelos 3D; a repetição completa sem essa concorrência passou. [Log](../output/playwright/unit-investigacao-isolada-2026-10-01.log).
- E2Es afetados de sessões, múltiplos streams, entrada tardia e áudio na green room: **4/4 aprovados**. [Relatório](../output/playwright/historical-suite-2026-10-01T17-01-03-818Z/report.json).
- Tauri real com registro frio e aquecido: aprovados, com confirmação do transporte nativo direto.
- Entrega real 720p: aprovada; FPS registrado separadamente, sem promessa de 60 FPS em toda condição.
- **Relay continua pendente.** Não foi repetida toda a bateria histórica após cada ajuste; os dez cenários aprovados anteriormente não são apresentados como uma nova execução completa.

## Reprodução

```powershell
node tools/e2e/run.mjs --exe src-tauri/target/debug/seemygame.exe --seconds 15 --compare --cold-gstreamer-registry
node tests/e2e-720p-tree-benchmark.mjs --delivery-only --viewers 1
node tests/e2e-720p-tree-benchmark.mjs --delivery-only --viewers 3
node tests/e2e-720p-tree-benchmark.mjs --delivery-only --viewers 3 --no-replay
# Com a expectativa de relay mantida, estes cenários ainda expõem a pendência:
node tests/e2e-720p-tree-benchmark.mjs
node tests/e2e-tree-relay-benchmark.mjs
```
