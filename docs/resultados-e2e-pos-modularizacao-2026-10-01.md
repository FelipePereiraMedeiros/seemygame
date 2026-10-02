# E2E históricos após modularização — 01/10/2026

> Atualização: a investigação posterior identificou e corrigiu regressões no envio/negociação de Room e no início nativo. O relay permanece pendente, e o custo do replay foi reproduzido. Veja [a investigação e suas novas evidências](investigacao-falhas-e2e-2026-10-01.md). Os resultados abaixo preservam a bateria original.

## Resultado

Executamos os cenários históricos contra o checkout atual, após adaptar o acesso ao estado modular. Na bateria final: **10 runners aprovados e 2 reprovados**. O E2E separado com Tauri real também falhou na inicialização da transmissão. Portanto, a validação não está inteiramente verde.

Relatório final: `output/playwright/historical-suite-2026-10-01T16-15-56-812Z/report.json`. Cada cenário tem seu log no mesmo diretório e, quando previsto pelo runner, screenshots e JSON próprios.

| Runner | Resultado | Verificação |
|---|---|---|
| `e2e-sessions.mjs` | PASS | PIN incorreto/correto, chat por data channel, vídeo decodificado e entrada tardia em Room |
| `e2e-whiteboard-multi-client.mjs` | PASS | Desenhos, cursores e identidade sincronizados em três clientes; retorno à sala |
| `e2e-green-room-audio.mjs` | PASS | Prévia de microfone, VU, mute/unmute, dispositivos, teste de som acionado e ingresso efetivo |
| `e2e-room-persistence-audit.mjs` | PASS | Transmissão nos dois sentidos, permanência de 15 s, recarga sem fantasmas e três usuários sem apelido |
| `e2e-visual-audit.mjs` | PASS | Dois espectadores, saída/reentrada, deduplicação, coordenador após reload e confirmação de F5 |
| `e2e-multi-stream-scenario.mjs` | PASS | Cinco cenários entre quatro clientes, troca de transmissor, janela/monitor e remoção dos vídeos após parar |
| `e2e-late-joiner-trios.mjs` | PASS | Quatro combinações de três clientes; entrada durante transmissão e limpeza ao parar |
| `e2e-tree-relay-benchmark.mjs` | FAIL | Não existe espectador roteado pela árvore; topologia permanece vazia |
| `e2e-720p-tree-benchmark.mjs` | FAIL | Resolução efetivamente recebida ficou abaixo de 720p; três envios diretos e nenhuma rota relay |
| `e2e-whiteboard.mjs` | PASS | Abertura, desenho e fechamento da lousa em Room e Streamer |
| `e2e-controller-lab.mjs` | PASS | Quatro participantes, convite/aceite, inputs isolados, checklist, modelos WebGL, layout móvel e fluxo Room |
| `e2e-gamepad-visual.mjs` | PASS | Renderização e inputs dos modelos de controle |

Os nomes DesktopA/DesktopD nos runners históricos são **fixtures JavaScript do Tauri e da captura**, executadas no Chrome. Esses cenários validam integração frontend e WebRTC real, mas não WGC, WASAPI, GStreamer ou controles físicos. O teste de controles tampouco valida a injeção física via ViGEmBus nem o fluxo novo de concessão/revogação na sala de controles.

## Regressões encontradas e corrigidas nesta execução

1. `RoomManager.onStateChange` não estava ligado ao controlador visual. A rede funcionava, mas a lista de participantes permanecia vazia e a grade de vídeos oculta. Restauramos presença e alternância entre palco de voz e vídeo.
2. O entrypoint modular da pré-sala enumerava dispositivos, mas não montava prévia, VU e mute. Reutilizamos o módulo de Green Room com dependências explícitas e descarte pertencente à sessão. A prévia para ao entrar, e um microfone concedido depois do descarte é imediatamente liberado.
3. Usuários sem apelido recebiam todos `Gamer`. A deduplicação por nome interpretava um terceiro usuário legítimo como reconexão de outro e o expulsava. Restauramos nomes padrão Host/Amigo com sufixo do peer.
4. A identidade de aba usada na admissão era o ID temporário da sessão de runtime. Restauramos o ID persistido em `sessionStorage` para atravessar recargas.
5. F5 perdeu a ligação com a confirmação de recarga. Restauramos o listener da sessão e sua remoção no descarte.

Os E2E de persistência e auditoria visual reproduziram as falhas e passaram após as correções. Os dois testes novos de ciclo de vida da Green Room cobrem liberação de permissão tardia e transferência do mute com encerramento da prévia.

## Correções nos próprios instrumentos

- Acesso ao estado real pelos módulos `js/entries/*`, sem restaurar globais de compatibilidade no produto.
- PeerJS local e conexões WebRTC reais, usando perfis isolados. Não foi usado o deployment de produção.
- Esperas assíncronas agora aguardam o resultado do predicado. Nesta versão de Playwright, uma Promise retornada por `waitForFunction` podia ser aceita antes de resolver para `false`. As primeiras execuções que ainda usavam essa espera não contam como evidência de aprovação.
- Correção da posição do argumento `timeout` nos runners antigos.
- Recepção exige frames decodificados, além de uma trilha em estado `live`.
- Screenshots/relatórios antigos deixaram de escrever em diretórios externos fixos; usam `output/playwright`.
- A auditoria visual agora falha quando as condições antes apenas impressas no console não são satisfeitas.
- O benchmark de árvore exige topologia real. Removemos a subtração de `currentTime` de vídeos distintos como suposta latência de relay.
- O runner 720p mede frames apresentados com `requestVideoFrameCallback`, após 8 s de aquecimento e durante aproximadamente 8 s de amostragem. Removemos afirmações incondicionais de 60 FPS, bitrate entregue e saturação de uplink.
- Fixtures unitárias de Co-op foram atualizadas com identidade de conexão e slot aprovado. Não relaxamos a validação de identidade do produto para fazê-las passar.

## Pendências comprovadas

### P1 — Inicialização da captura nativa real

Comando executado:

```powershell
node tools/e2e/run.mjs --exe src-tauri/target/debug/seemygame.exe --channel chrome --seconds 15 --compare
```

Relatório: `output/playwright/2026-10-01T16-12-41-235Z-1e5f31/report.json`.

- Build debug recompilado com o frontend atual; a comparação de hashes dos assets embarcados passou.
- WebView2 conectado por CDP; Tauri e Chrome entraram na mesma sala e confirmaram autorização mútua.
- Seleção da janela sintética exclusiva do run ocorreu. Nenhuma janela pessoal foi selecionada como fonte.
- Espectador não reproduziu vídeo em 45 s.
- `stop native capture` excedeu 15 s durante limpeza.
- O log termina, para essa operação, em `start_native_capture`; não há registro subsequente de encoder selecionado ou worker ativo. Isso localiza a investigação antes da transmissão útil, mas **não identifica ainda a função exata que bloqueia**.
- A fase comparativa web não chegou a executar. **Não existem dados válidos de FPS/latência A/B dessa rodada.**

A primeira tentativa com sinalização local foi bloqueada pela CSP embarcada. A segunda habilitou bypass de CSP somente na página isolada de teste via CDP. A CSP do produto não foi alterada; esse E2E não valida sua política de conexão. O runner agora registra também mensagens de console de erro/aviso.

Próximo diagnóstico: medir entrada/saída de `MediaWorkerConfig::from_environment`, `resolve_and_validate_config`, `GStreamerRuntime::probe`, cada inspeção de plugin, spawn do worker e fanout. `inspect_element` contém `Command::status()` sem prazo; é um candidato a espera ilimitada, não uma causa comprovada. A inicialização síncrona também precisa ser examinada antes de atribuir o problema a rede, jitter ou sincronização A/V. Separar testes de descoberta do runtime, início de captura, preview e envio ao espectador; exigir cancelamento e limpeza com prazo em cada etapa.

### P1 — Relay ausente no caminho Room

O estado observado foi: três chamadas de mídia na origem, `maxDirectViewers = 8`, mas `totalViewers = directCount = relayedCount = 0` no gerenciador de árvore.

O contrato antigo de dois filhos diretos não corresponde à configuração atual de oito. Além disso, os caminhos de publicação e entrada de membros fazem `peer.call` diretamente sem cadastrar espectadores ou executar a decisão de rota do `RelayManager`. Alterar apenas o limite ou flexibilizar a asserção não comprova retransmissão.

Próxima correção: definir o limite atual desejado e integrar cadastro, eleição, sinalização, mídia e saída/reconexão ao runtime de sala. Validar a rota pela conexão efetiva de origem/parent/child, frames no filho e quantidade de chamadas na origem; também testar queda do pai e transferência de rota.

### P2 — Entrega de resolução/FPS abaixo da fonte 720p

Evidência: JSON `historical-720p-tree-benchmark-*/observed-720p.json` dentro da bateria final.

| Camada | Observado |
|---|---|
| Fonte | 1280×720, track configurada para 60 FPS |
| Viewer 1 | 640×360, 289 frames apresentados, 36,03 FPS |
| Viewer 2 | 640×360, 290 frames apresentados, 36,20 FPS |
| Viewer 3 | 640×360, 280 frames apresentados, 34,98 FPS |

Isso é uma falha do contrato 720p do cenário, sem comprovar um teto de desempenho do produto: são processos headless, fonte sintética e rede local. Não medimos carga GPU, bitrate real, motivo de limitação ou glass-to-glass nesse runner.

Há um ponto concreto a verificar: `room-session.js` importa `hookPeerConnectionSdp`, `applyTransceiverOptimizations` e serviços de stats, mas não os aplica às chamadas de mídia. A seguir, coletar `getStats` em cada conexão com `qualityLimitationReason`, resolução codificada/decodificada, bitrate delta, parâmetros do sender, codec e perda. Comparar um versus três espectadores, sem simultaneamente alterar preset ou fonte, antes de decidir se a queda vem de adaptação normal, configuração esquecida ou custo de múltiplos encoders.

## Validação adicional

- Vitest: **83 arquivos / 851 testes aprovados**. Log: `output/playwright/unit-regressions-2026-10-01.log`.
- Grafo de módulos, partials HTML, imports CSS e smoke ESM aprovados.
- `npm run build:dist` e `cargo build --manifest-path src-tauri/Cargo.toml --locked --offline` concluíram. Build passou; isso não equivale a captura nativa funcional.

## Reexecutar

```powershell
npm run test:e2e:historical
```

Cada execução gera diretório próprio, logs individuais, relatório consolidado e código de saída diferente de zero quando houver falhas. Para escolher cenários:

```powershell
npm run test:e2e:historical -- e2e-visual-audit e2e-room-persistence-audit
```

Os dois benchmarks permanecem vermelhos intencionalmente enquanto seus contratos não forem atendidos. Não foram executadas todas as baterias históricas de stress, áudio/dispositivos físicos, encoder, YouTube, Internet/TURN ou anticheat. Também não foram usados binários antigos como substituto da validação do código atual.
