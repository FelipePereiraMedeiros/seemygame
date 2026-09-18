# Revalidação do diagnóstico E2E de 172 ms × 100 ms

## Parecer

A execução `2026-09-17T15-05-17-098Z-e30bd8` registra p50 óptico de 172 ms no nativo e 100 ms no web: razão 1,72 e diferença 72 ms. Isso descreve o benchmark instrumentado, não demonstra que captura nativa seja intrinsecamente 72% mais lenta nem identifica causalmente toda a diferença. As correções melhoraram a evidência, mas a declaração de resolução completa D01–D07 e a promessa de 60–80 ms ainda são prematuras.

Foram inspecionados os arquivos atuais, o novo documento, relatórios recentes e a screenshot nativa. A suíte completa foi reexecutada: **435/435 testes, 41 arquivos, passaram**. Não foi iniciada nova captura nem alterado código de produção/telemetria nesta revalidação.

## Melhorias confirmadas

- A screenshot do novo A/B mostra a fonte sintética e o estado nativo confirma `sourceType: window`, H.264 1920×1080 e áudio `none`.
- Preâmbulo ampliado, magic de sessão e CRC-16 reduzem substancialmente os falsos positivos. Sequências recebidas avançam e existem leituras válidas numerosas.
- Os novos testes incluem marcador de outra sessão, corrupção de bits, tela verde, cores sólidas, ruído e escala fracionária.
- Foram adicionados `metadata.presentedFrames`, duração da análise, seleção preferencial de conexões conectadas com tráfego e separação do tempo de decode/buffer da ponte.
- Existem estados distintos de funcionalidade, validade e desempenho. O relatório declara a mudança de runtime entre fases, embora o texto externo apresente condições como idênticas.

## Pendências que afetam a interpretação

### P1 — A instrumentação interfere na latência e no FPS

O relatório registra custo da análise óptica por callback:

| Fase | p50 | p95 |
|---|---:|---:|
| Nativa | 22,7 ms | 59,8 ms |
| Web | 21,2 ms | 31,1 ms |

Um frame a 60 FPS tem intervalo de 16,67 ms. O coletor faz drawImage/getImageData e busca de marcador na thread principal em cada callback; o timestamp de recepção é lido depois desse trabalho. O p50 óptico inclui portanto parte do custo de análise e pode ser influenciado pela carga que ela própria causa. Não é correto simplesmente subtrair medianas para obter uma latência corrigida.

Prioridade: timestamp antes da análise e associação ao `expectedDisplayTime`/`presentationTime`, ROI localizada e reutilizada, amostragem limitada, processamento fora da thread principal quando viável e comparação instrumentação ligada/desligada. O resultado continua sendo estimativa software de idade visual, não medição física de emissão de luz do monitor.

### P1 — As pausas são consumidas antes do classificador

`telemetry.mjs:getStats()` lê `intervalMaxPauseMs` e o zera. `sampleBoth()` chama `sample()`, que já chama esse getter. Logo depois, `sampleAndAnalyze()` chama o getter novamente para o mesmo vídeo. A timeline recebe zero ou apenas eventos ocorridos entre as duas chamadas.

Reprodução offline com o `installTelemetry` real e callback controlado: **rawPause=220 ms; timelinePause=0 ms**. O relatório real preserva pausas brutas de 1333 e 202 ms no lado web, enquanto o diagnóstico diz zero stutters. Não se pode afirmar ausência de engasgos nem atribuir todas as pausas a startup sem relacioná-las à fase correta.

Correção: uma única leitura por intervalo, identificada por vídeo/track e reutilizada pelo diagnóstico; separar leitura de reset. Testar pausa no intervalo estável e duas leituras consecutivas.

### P1 — Aprovação de desempenho não é uma meta de qualidade

No A/B, `minFps=0`, portanto `performancePassed=true` por padrão. A expressão compara apenas a mediana nativa com a meta opcional; não exige latência máxima, limite de engasgos ou desempenho da fase web. `measurementValid` pede cinco leituras e que ao menos uma sequência recente exista no log da fonte. Não verifica a correspondência completa `(sessão, sequência, timestamp)`, frescor de todas as amostras ou cobertura ao longo da execução.

Estados distintos são uma melhoria, mas os critérios ainda permitem aprovação fraca. Sem meta configurada, desempenho deveria constar como não avaliado. Ambas as fases precisam de critérios explícitos e de validade temporal.

### P2 — O A/B permanece curto e não isola só captura

- Build testado: debug.
- Somente **três amostras** entram na mediana de FPS estável de cada fase.
- A latência óptica agrega toda a coleta, incluindo warmup/cooldown; os tempos de encode/ponte usam somente steady.
- A fonte efetiva varia aproximadamente **154–165 FPS**, apesar de o documento declarar 60 FPS. `requestAnimationFrame` não é limitado a 60 no gerador atual.
- Nativo: WebView2 transmite e Chrome recebe. Web: Chrome transmite e WebView2 recebe. Mesma máquina/janela não elimina diferenças de runtime, foco, compositor e concorrência.
- Ambos os receptores dessa execução reportam `FFmpeg (fallback from: ExternalDecoder (D3D11VideoDecoder))`. Isso merece investigação específica, sem atribuição automática de causa.

Executar release, limitar fonte e perfil explicitamente, manter o mesmo receptor, alternar ordem A/B e B/A, separar aquecimento por tempo real e repetir períodos estáveis de pelo menos 60 segundos. Não concluir “web descartou 19 frames/s” apenas de 60 menos 41,4: esse cálculo não mede descartes e a fonte sequer estava a 60 FPS.

### P2 — Associação, protocolo e rastreabilidade ainda incompletos

- `.find()` prefere conexões com contadores cumulativos positivos, sem comprovar progresso no intervalo nem identidade peer/track/SSRC. Persistem fallbacks mais permissivos.
- O seletor procura somente `SMG E2E Motion`, não o runId exato; uma janela antiga também pode corresponder.
- Decoder óptico continua duplicado no módulo testado e no código injetado. CRC detecta erros, não oferece integridade criptográfica nem elimina toda colisão.
- Timestamp uint32 ainda sofre wrap a cada aproximadamente 49,7 dias; a subtração simples atual falha ao atravessar essa fronteira, mesmo em teste curto. Tratar diferença modular e validar contra o log original.
- O novo documento muda os significados de D04, D05 e D06 em relação à auditoria original. Corrigir afinidade de desktop não resolve por si o D04 original sobre semântica do custo da ponte.
- As **347 leituras** citadas vêm de `15-03-43...`, que teve 177 ms e 48,55 FPS. O A/B `15-05-17...` teve **261 leituras nativas e 344 web**, com 172/100 ms e 54,45/41,38 FPS. Não misturar execuções.

## Avaliação da explicação dos 72 ms

| Afirmação | Parecer |
|---|---|
| Nativo teve 172 ms e web 100 ms | Confirmada como p50 do coletor nesta execução; 72% maior ou 1,72× |
| Existe dupla codificação no caminho nativo atual | Condiz com a arquitetura; candidato plausível a custo extra |
| Ponte tem 2,54 ms decode + 14,96 ms jitter | Valores confirmados como médias dos intervalos estáveis; soma parcial de 17,50 ms, não custo completo da ponte |
| Outbound nativo 20,45 ms vs web 9,70 ms | Confirmado; diferença de 10,75 ms nas médias dos intervalos, não decomposição causal do p50 ponta a ponta |
| Primeiro encode e RTP custam cerca de 20 ms | Estimativa sem medição dessa etapa no relatório |
| Receptor tem 20–25 ms por maior FPS/bitrate | No steady nativo há 22,72, 44,11 e 56,03 ms de jitter; no web 8,65, 8,60 e 7,69 ms. A causalidade proposta não foi isolada |
| Áudio nativo sem bloqueios de driver | Não testado neste benchmark: áudio `none` |
| Transmissão direta economizará 50 ms e chegará a 60–80 ms | Hipótese de otimização, não resultado. Mesmo subtrair 50 de 172 daria 122 ms |

Médias de componentes em intervalos distintos não somam necessariamente à diferença de medianas. Falta correlacionar tempos por frame e medir captura, primeira codificação, filas, composição e instrumentação. Não há evidência suficiente para explicar os 72 ms integralmente.

## Rota de otimização defensável

1. Corrigir a medição e reduzir sua intrusão; validar pausas, proveniência e metas.
2. Medir fallback de decode, encode nativo e filas; comparar replay ligado/desligado e perfis equivalentes.
3. Prototipar envio WebRTC direto do backend como experimento. Ele pode remover decode local, jitter local e recodificação, mas precisa manter sinalização, autorização, ICE/TURN, feedback de congestionamento, PLI/NACK, áudio e limpeza. Medir o ganho em vez de prometer FPS/latência.

## Referências

[requestVideoFrameCallback](https://wicg.github.io/video-rvfc/) define timestamps de apresentação esperada e limitações de callbacks. [WebRTC Stats](https://www.w3.org/TR/webrtc-stats/) distingue acumuladores de encode/decode e tempo no jitter buffer. Resultados desta reexecução de testes: `docs/resultados-revalidacao-e2e-2026-09-17.json`.
