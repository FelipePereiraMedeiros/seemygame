# Revisão dos resultados E2E — envio nativo direto

Análise em 17/09/2026. Último relatório completo localizado: `output/playwright/2026-09-17T23-13-23-066Z-63387d/report.json`. Comparação histórica principal: `2026-09-17T22-11-56-873Z-00f237`. Foram examinados dados brutos, logs e código atual. Não foi executado novo benchmark nesta revisão.

## Parecer

O envio nativo direto está implementado e foi exercitado com sucesso no teste local. O resultado é promissor: aproximadamente 60 FPS e 67 ms de latência mediana em regime permanente. Entretanto, o comparativo ainda não controla resolução, ambiente do receptor, sobrecarga da instrumentação nem carga de jogo. O relatório continua usando métricas e rótulos da arquitetura antiga.

Isso comprova uma execução funcional local e uma melhora observada. Não comprova ainda estabilidade sob jogos, funcionamento em redes restritivas ou superioridade geral sobre o web.

## Resultados observados

| Métrica | Nativo anterior 22:11 UTC | Nativo direto 23:13 UTC | Web da execução 23:13 UTC |
|---|---:|---:|---:|
| FPS mediano steady | 29,53 | 59,96 | 41,47 |
| Latência p50 | 249 ms | 67 ms | 91 ms |
| Latência p90 | 256 ms | 74 ms | 103 ms |
| Latência p99 | 297 ms | 96 ms | 129 ms |
| Intervalos classificados como stutter | 22 | 2 | 1 |
| Leituras ópticas steady | 177 | 213 | 229 |
| Resolução efetiva recebida | 1920×1080 | 1920×1080 | 1282×800 |
| Decode médio entre intervalos steady | 108,0 ms | 2,06 ms | 0,79 ms |
| Decoder informado | D3D11VideoDecoder | FFmpeg, fallback de D3D11 | FFmpeg, fallback de D3D11 |

Na última execução, o nativo teve p50 24 ms menor que o web (26,4%) e aproximadamente 44,6% mais FPS decodificados. Contra a execução nativa anterior, o p50 caiu cerca de 73,1%. São comparações descritivas, sem isolamento causal ou estimativa de variabilidade entre repetições equivalentes.

A execução `23-01-16-544Z-f75c40` falhou: o espectador não reproduziu vídeo em 45 segundos. A execução de 23:00 era apenas preflight. Não contabilizá-las como repetições bem-sucedidas. A execução de 20:21 também falhou.

## Mudanças comprovadas

O novo caminho é:

```text
WGC → conversão NV12 → NVENC H.264 → RTP/UDP local → fan-out
                                                        ├→ WebRTC → preview WebView2
                                                        └→ WebRTC → espectador web
```

O preview continua existindo, mas não é mais a origem do vídeo recodificado para esse espectador. `capture.rs:822` cria a ponte por espectador; `app.js:1502` negocia uma conexão receptora própria. O log registra criação da ponte direta e uso de `nvd3d11h264enc` na RTX 3070.

O encoder NVENC já era usado às 22:11. Portanto, o salto entre essas duas execuções não deve ser apresentado como efeito de trocar Media Foundation por NVENC. Houve mudança do caminho de transmissão e do decoder efetivo do receptor, entre outros possíveis fatores.

A criação do worker agora inclui `HIGH_PRIORITY_CLASS` em `media.rs:672`, atendendo à pendência de prioridade explícita de CPU do processo de mídia. Isso ainda não configura prioridade de GPU; não encontrei chamada correspondente ou cadastro MMCSS no caminho revisado.

## Pendências do instrumento e das conclusões

### P1 — Comparativo declara condições diferentes das efetivas

`tools/e2e/run.mjs:780` declara 1280×720 @ 60 nos dois modos. Os stats recebidos mostram 1920×1080 nativo e 1282×800 web. O pipeline nativo logado também confirma 1080p. Fonte nominal não equivale à resolução codificada.

Correção: registrar configuração solicitada, track settings, caps do encoder e dimensão recebida; invalidar a comparação controlada quando divergirem. Fixar navegador/receptor entre fases: atualmente os papéis de navegador e WebView2 se invertem.

### P1 — Telemetria de saída não acompanha o envio direto

Encode, bitrate de saída e implementação do encoder nativo aparecem como `null`: a coleta procura outbound no navegador, mas agora o emissor é GStreamer. A limitação ausente vira `none`, o que confunde desconhecido com ausência de gargalo.

Os 11,74 ms de `bridgeObservableLatencyMs` vêm do decode+jitter do preview. Não são um custo serial do caminho direto até o espectador. Renomear para preview e coletar stats do webrtcbin remoto e tempos do encoder. Incluir identidade/role das conexões, em vez de selecionar o primeiro inbound/outbound conectado.

### P1 — Decoder é uma variável importante não isolada

No teste anterior, o receptor registrou 108 ms de decode médio entre intervalos, 1.136 frames descartados no último snapshot e 49 PLIs. No último, o receptor reporta fallback FFmpeg, cerca de 2,06 ms de decode e 33 descartes no último snapshot da fase nativa, com 9 PLIs.

Isso é um indício forte de problema no caminho anterior de recepção/decode. Não prova um defeito do driver nem que software decode seja sempre melhor. Investigar perfil/bitstream, recuperação de keyframes, carga concorrente e comportamento do decoder. Comparar a mesma arquitetura com hardware/software decode controlados em experimento diagnóstico.

### P1 — `passed` não é um limite de qualidade satisfatório

Em `run.mjs:874`, aprovação de desempenho depende apenas do FPS mediano nativo e `--min-fps`, cujo padrão é zero. Não há limite para p95/p99, freezes, startup, descarte ou qualidade visual. Mesmo os resultados anteriores com 249–336 ms foram aprovados.

Separar sucesso funcional, validade experimental e metas de desempenho. No modo compare, verificar critérios das duas fases e declarar explicitamente quando metas não foram configuradas.

### P2 — Startup e stutters ainda exigem tratamento

O último nativo teve pausa de warmup de 1.755 ms. Stats acumulados do receptor registram um freeze de 1,61 s; em steady, o classificador aponta pausas de 364 e 153 ms. A contagem é de intervalos sinalizados, não necessariamente de eventos físicos independentes.

`timeToFirstFrameMs=78` começa na instalação do hook de telemetria; não mede o tempo desde o clique em transmitir. A etapa E2E de seleção/início levou cerca de 26 segundos, incluindo operações do teste. Nenhum desses valores, isoladamente, representa o startup percebido pelo usuário. Registrar timestamps distintos de solicitação, captura, oferta, conexão, primeiro decode e primeira apresentação.

### P2 — Fases não usam duração real e os intervalos têm desalinhamento

O loop coleta stats, muda a fase e lê pausas acumuladas, depois espera um segundo. Assim, a primeira linha rotulada steady pode conter contadores do intervalo anterior de warmup, enquanto a latência óptica muda de fase daquele ponto em diante.

Além disso, 30 iterações levaram cerca de 37,6 s no nativo e 41,9 s no web. `steadyDurationSec=23` representa quantidade de intervalos, não duração medida. Usar deadlines monotônicos, limites de fase comuns e duração real por intervalo.

### P2 — Instrumentação continua relevante

Overhead óptico p50/p95: nativo 14,6/18,4 ms; web 2,5/3,6 ms. O custo não deve ser somado diretamente à latência, mas pode alterar o pipeline e atrasar callbacks. Os resultados não foram obtidos com perturbação equivalente.

O relatório final tem aproximadamente 56 MB. O teste serializa checkpoints completos dentro do loop; dados acumulados da fonte são repetidos nas medições. Medir custo de coleta/escrita, guardar logs por referência e usar registros incrementais. Comparar coleta desativada, leve e óptica. `duplicateFrames=0` com leitura óptica espaçada não comprova ausência de duplicações entre amostras.

## Cobertura de testes verificada

Executei:

```text
npx vitest run tests/e2e-telemetry.test.js tests/review-native-bridge.test.js tests/review-app-integration.test.js tests/desktop.test.js tests/review-desktop-contract.test.js
```

Resultado: **5 arquivos, 44 testes aprovados**. A primeira tentativa falhou por `spawn EPERM` no sandbox; a execução autorizada fora dele passou. Houve avisos de canvas não implementado no jsdom, portanto os mocks não validam custo ou leitura real de pixels.

Os testes novos de desktop verificam argumentos dos comandos de viewer. Os testes de bridge cobrem principalmente a conexão local anterior. O teste de fases verifica mudança de estado e arrays inicialmente vazios; não injeta latências conhecidas entre fases para comprovar exclusão de warmup e fronteiras temporais.

Não executei toda a suíte nem testes Rust nesta revisão. Não encontrei cobertura comportamental específica suficiente para negociação direta, ICE fora de ordem, sessões antigas, retransmissão/keyframe, fan-out concorrente e recuperação de falhas.

## O que testar antes de promover o caminho direto

1. **Instrumento:** dimensões divergentes devem invalidar A/B; intervalos por tempo real; fixtures ópticas com percentis conhecidos por fase; ausência de métricas deve resultar em desconhecido; preview nunca compõe custo do envio direto.
2. **Conexão:** oferta/resposta/ICE fora de ordem, viewer reconectando, sessão encerrada durante negociação, limpeza de fan-out, dois espectadores simultâneos e host que também assiste a outro host.
3. **Rede:** duas máquinas/redes e TURN forçado. O webrtcbin atual configura STUN fixo; não encontrei integração de credenciais TURN no emissor Rust. Isso não significa que toda conexão remota falhará, mas o teste local não cobre redes restritivas.
4. **Recuperação:** perda controlada, PLI até o encoder original, bitrate sob banda restrita. O worker com encode fixo e a distribuição de RTP não demonstram, sozinhos, adaptação de congestionamento por receptor.
5. **Áudio:** o último teste usa `audio_mode=none`; validar WASAPI, Opus, A/V sync e replay com trilhas que chegam separadamente.
6. **Desempenho:** release, mesma resolução/qualidade, mesmo receptor, ordem A/B alternada, ao menos cinco repetições mais longas; preview e replay controlados.
7. **Jogos:** GPU e CPU sob carga, jogo em primeiro plano, métricas do jogo e da transmissão, prioridades registradas. A última execução não traz medições de carga CPU/GPU ou frame time do jogo.

## Conclusão

O novo caminho entrega um resultado local substancialmente melhor e justifica continuar a implementação. As prioridades imediatas são tornar o relatório consciente da arquitetura direta, corrigir a equivalência do A/B e investigar a mudança de decoder. Depois, validar rede real, áudio e estabilidade durante jogos. Nenhuma mudança de produção foi feita nesta revisão.
