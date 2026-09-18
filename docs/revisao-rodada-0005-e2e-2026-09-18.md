# Revisão da rodada 00:05 UTC — correções e E2E

Execução analisada: `output/playwright/2026-09-18T00-05-41-626Z-ce2458/report.json` (17/09 às 21:05 no horário local). Comparação: execução de 23:13 UTC. Revisão de código e dados; não foi executado novo benchmark.

## Parecer

A transmissão nativa apresenta um segundo resultado local favorável, agora com cauda menor e sem stutters detectados. Algumas correções foram efetivadas, mas a mudança de isolamento do PIN introduziu uma regressão de autorização reproduzida por teste. Corrigir essa regressão antes de publicar a rodada.

## 1. P1 — conexão não admitida recebe chamada de vídeo

Em `js/app.js:1386`, `isRoomAuthorized` usa `isRoomMode() || roomManager.isPeerAuthorized(conn.peer)`. Estar na página da sala torna a expressão verdadeira independentemente da admissão do participante. No evento `open`, o código adiciona o peer a `authenticatedViewers` e inicia mídia se houver stream local.

O mesmo padrão aparece no tratamento de mensagens (`:1441`) e na distribuição ao iniciar transmissão (`:2464`). Embora RoomManager rejeite mensagens não autorizadas, esse bloqueio não protege o envio automático no evento `open`.

Reprodução local com mocks, usando a estrutura de `tests/room-pin-isolation.test.js`:

```js
const p = app.initPeer();
p.emit('open', 'peer-review-host');
app.roomManager.setRoomPin('room-secret');
navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(
  new MockMediaStream([new MockMediaStreamTrack('video')])
);
await app.startLocalStream();
const stranger = new MockDataConnection('peer-review-stranger');
const callSpy = vi.spyOn(p, 'call');
p.emit('connection', stranger);
stranger.emit('open');
expect(app.roomManager.isPeerAuthorized(stranger.peer)).toBe(false);
expect(callSpy).not.toHaveBeenCalledWith(stranger.peer, expect.anything());
```

A primeira asserção passou; a segunda falhou: `peer.call` recebeu o peer não admitido e o stream local. O log registrou “Iniciando chamada com foco em alta fluidez para: peer-review-stranger”. Isso comprova envio indevido no caminho web testado. O fluxo direto compartilha a condição incorreta e também precisa de teste próprio; não foi demonstrada recepção real via navegador nesse experimento com mocks.

Correção recomendada: separar modo de sala de autorização. No modo de sala, somente membros explicitamente admitidos podem receber mídia ou negociar stream direto. Não recorrer ao PIN residual de streamer, mas também não autorizar todos por estarem conectados. Revalidar autorização na função central de início de mídia e ao iniciar transmissão com conexões já pendentes.

Os testes novos cobrem membros autorizados e o conflito entre PIN de sala e PIN residual. Falta o caso negativo acima, PIN errado, participante pendente, removido e nova sessão.

## 2. P2 — credenciais TURN gravadas no log

`js/app.js:1704` monta URI com username e credential. `src-tauri/src/webrtc_bridge.rs:123` grava essa URI completa ao adicionar TURN. Logo, credenciais podem aparecer no arquivo de diagnóstico quando houver TURN configurado.

Registrar somente scheme/host/porta, omitindo userinfo. O retorno booleano de `add-turn-server` é descartado em `:127`; configuração rejeitada deve gerar erro explícito ou diagnóstico sem segredo. Adicionar teste com credenciais sentinela para garantir que não apareçam em logs.

## 3. Resultado de desempenho

| Métrica | Nativo anterior | Nativo atual | Web atual |
|---|---:|---:|---:|
| FPS mediano steady | 59,96 | 59,86 | 27,23 |
| Latência p50 | 67 ms | 64 ms | 110 ms |
| Latência p90 | 74 ms | 72 ms | 172 ms |
| Latência p99 | 96 ms | 78 ms | 404 ms |
| Intervalos com stutter | 2 | 0 | 5 |
| Pausa máxima de warmup medida pelo hook | 1.755 ms | 0 ms | 105 ms |
| Overhead óptico p50 | 14,6 ms | 2,3 ms | 4,4 ms |

O ganho mais relevante do nativo nesta rodada é a regularidade. A diferença de 3 ms na mediana não deve ser tratada isoladamente como ganho estatisticamente demonstrado. A resolução nativa também mudou de 1080p para 720p, reduzindo trabalho; não é comparação com condições idênticas à rodada anterior.

No receptor nativo, o último snapshot registra `freezeCount=0`, `packetsLost=0`, 20 frames descartados e 8 PLIs. Zero stutters pelo classificador não significa ausência de qualquer descarte. A latência máxima steady foi 143 ms, com 212 leituras ópticas válidas.

No web, a regressão é relevante: 41,47 → 27,23 FPS e p99 129 → 404 ms. Houve três freezes acumulados, totalizando 1,744 s, e máximo óptico de 1.535 ms. O decoder atual é D3D11, enquanto na rodada anterior era fallback FFmpeg. Isso não comprova causalidade: o decode não apresenta a mesma demora extrema vista em execuções mais antigas. Investigar captura/cadência, apresentação e carga, sem atribuir a queda automaticamente ao decoder.

## 4. Correções verificadas e limites

- **Preview:** campos do resumo passaram de `bridge*` para `localPreview*`. Os 8,44 ms agora identificam o preview, não atraso serial do envio direto. A timeline e a classificação ainda mantêm referências à ponte; falta identificar papéis e arquitetura em toda a análise.
- **ICE local/remoto:** `js/native-webrtc.js:265` ignora eventos com peerId, evitando misturar candidatos dos espectadores na conexão de preview. Falta regressão comportamental específica.
- **TURN:** servidores e credenciais agora são encaminhados do frontend ao webrtcbin. Implementação presente não equivale a relay validado. O E2E segue local e não força TURN.
- **PIN:** interface separa PIN de sala do PIN residual, e os casos positivos passam. A autorização ficou permissiva demais, conforme reprodução acima.
- **Build:** a tentativa `00-03-54-594Z-15c815` foi corretamente bloqueada por `js/app.js` desatualizado no executável. A execução seguinte utilizou outro hash e passou. Essa falha é uma proteção funcionando, não falha da transmissão.

## 5. Pendências metodológicas que continuam

1. O resumo ainda declara 1280×720 para ambos, mas os frames recebidos são **1280×720 nativo e 1152×720 web**. Altura igual não torna os quadros equivalentes; confirmar superfície, bordas/aspecto e settings efetivos.
2. Receptor muda entre Chromium e WebView2; decoder também difere entre fases.
3. Encode de saída nativo continua `null`. Não há medição suficiente do emissor GStreamer para localizar o custo restante.
4. Aprovação de desempenho continua permissiva, sem limites obrigatórios para freezes, latência ou as duas fases do comparativo.
5. O teste continua usando executável debug e fonte sintética, sem comprovação de carga de jogo ou métricas de GPU/CPU. Não demonstra prioridade de GPU.
6. Persistem contagem de fases por iteração, custo de checkpoints e medida de primeiro frame relativa ao hook, em vez do clique do usuário.

## 6. Testes executados nesta revisão

```text
npx vitest run tests/room-pin-isolation.test.js tests/pin-auth.test.js tests/desktop.test.js tests/webrtc.test.js tests/review-native-bridge.test.js tests/e2e-telemetry.test.js
```

**6 arquivos e 99 testes passaram.** O teste adicional de participante não admitido falhou conforme descrito. Foi criado em arquivo temporário e removido após a reprodução; o caso e a evidência ficam preservados neste documento. Não foram alterados arquivos de produção.

Os testes desktop de TURN verificam a passagem do argumento ao comando. Não exercitam servidor TURN, autenticação, relay ou validação da URI pelo GStreamer. Não executei suíte Rust nem toda a suíte JavaScript nesta revisão.

## Próximas ações

1. Corrigir autorização de participantes e adicionar casos negativos de sala protegida e de início de mídia.
2. Remover credenciais dos logs e tratar rejeição de servidor TURN.
3. Validar TURN forçado, áudio, reconexão e múltiplos espectadores.
4. Corrigir dimensões/identidades das conexões no relatório e investigar a regressão web.
5. Repetir o comparativo em release com receptor fixo; depois testar o jogo sob carga, incluindo impacto no frame time da partida.
