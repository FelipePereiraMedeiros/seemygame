# CPU/GPU e isolamento da cadência — 2026-10-02

Complemento de [Telemetria e qualidade](modulos-telemetria-e-qualidade-2026-10-02.md). Objetivo: separar o desempenho da transmissão, a carga de outras aplicações e o custo do próprio instrumento. Resultados locais não homologam jogos nem duas máquinas.

## Implementação

O E2E real (`run.mjs`) e o laboratório de codecs (`quality-benchmark.mjs`) coletam, a cada segundo:

- CPU total, por processador lógico e processador mais ocupado; RAM disponível.
- GPU por adaptador e engine: 3D, VideoEncode, VideoDecode, Copy e demais engines expostos pelo driver; memória dedicada utilizada em bytes.
- CPU e working set dos processos do teste, separados entre Node, coletor, aplicativo, worker GStreamer, WebView2 e navegadores. Processos externos aparecem em grupo separado, com os maiores consumidores.
- Timestamp e idade da amostra de recursos na timeline de transmissão; custo da consulta e CPU do coletor no relatório.

GPU utiliza contadores Windows PDH em uma consulta persistente; processos utilizam Toolhelp e APIs somente de leitura. Não há drivers novos, injeção, hooks ou aumento de prioridade. Contadores ausentes/protegidos permanecem `null`, nunca são interpretados como 0%.

Percentual de CPU é normalizado pela capacidade da máquina: um núcleo completamente ocupado numa máquina de seis processadores lógicos corresponde a cerca de 16,7%. O núcleo mais ocupado também aparece, pois média baixa pode esconder saturação localizada. CPU externa é um limite inferior quando há processos inacessíveis. Working sets podem compartilhar páginas: sua soma não é memória física exclusiva.

Uso da GPU soma processos do **mesmo engine físico**; o resumo seleciona o engine mais ocupado. Não soma percentuais de 3D, encode e decode entre si. Essa interpretação acompanha a [explicação da Microsoft sobre GPU no Gerenciador de Tarefas](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/). A consulta usa [PdhAddEnglishCounterW](https://learn.microsoft.com/en-us/windows/win32/api/pdh/nf-pdh-pdhaddenglishcounterw), independente do idioma dos nomes de contadores do Windows.

Há avisos descritivos para CPU total p95 ≥85%, núcleo p95 ≥95%, engine GPU p95 ≥95%, RAM livre <1 GiB e GPU indisponível. São contexto, **não classificação causal de stutter**. Uma amostragem de 1 Hz não captura todo pico de poucos milissegundos.

Não são exportados caminhos, linhas de comando, nomes de usuário ou títulos de janelas pelo coletor. PID e nome do executável são registrados para atribuição local de carga. Navegadores fonte e espectador podem compartilhar o grupo `browser-e2e`.

### Custo do coletor

A primeira implementação baseada em consultas .NET de processos custava cerca de 224 ms por coleta. Após substituí-las por `OpenProcess`/`GetProcessTimes`/`GetProcessMemoryInfo`, um teste isolado de cinco amostras observou p95 de **8,4 ms** e CPU p95 do coletor de **0,26% da máquina**. É uma verificação curta, não garantia sob carga; cada E2E registra seu próprio custo, inclusive serialização de saída refletida no uso de CPU do processo.

`--no-system-metrics` permite rodadas sem o coletor. `collectionMs` cobre consultas; CPU do processo também reflete trabalho PowerShell/JSON. Se faltar o coletor, CPU/RAM podem continuar disponíveis sem GPU/processos. Conferir `resources.metadata.status`, quantidade e idade das amostras, além dos valores.

## Critérios corrigidos

- Entrega funcional e qualificação de qualidade são resultados separados. Um smoke que entrega vídeo pode passar funcionalmente e falhar na qualidade.
- Sem `--min-fps`, `performancePassed` é `null`; não afirma aprovação de desempenho sem requisito.
- `--min-fps` usa FPS **p10**, cobrindo quedas sustentadas, em vez de somente mediana.
- `--require-quality` exige o gate de duração/resolução/codec/cadência/apresentação. Retorno 0: passou o critério solicitado; 1: falhou; 2: evidência insuficiente. Conferir sempre o `verdict`, pois 0 no smoke não significa homologação de qualidade.
- Suite vazia ou com todos os codecs indisponíveis fica inconclusiva.
- Codec solicitado explicitamente precisa corresponder ao codec entregue; HEVC com fallback H.264 não qualifica HEVC. `auto` aceita o codec negociado.
- Fonte sintética agora recebe dimensões do perfil. Solicitar 1080p deixou de criar silenciosamente uma fonte canvas 720p. As dimensões codificadas recebidas continuam sendo verificadas separadamente.
- No A/B nativo/web, ambos recebem a mesma preferência de codec.
- `--optical-hz 0` desativa leituras de pixels, mas conserva contagem leve de apresentação. Latência visual fica `null`; não significa latência zero. Outros valores aceitos: 1–60 Hz.

## Isolamento do encoder

`npm run test:e2e:native-cadence` executa uma prova explícita/ignorada nos testes normais. Reaproveita a conversão, filas, videorate, encoder, parser e payloader de produção, mas troca WGC por fonte sintética com upload GPU e UDP por fakesink. Compara NVENC, Media Foundation e x264 a 60/120 FPS. Mede cadência após upload, videorate, conversão, entrada e saída do encoder; drop/duplicate do videorate; ocupação observada das filas.

Execute antes, separadamente:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib --no-run
npm run test:e2e:native-cadence
```

`SMG_PROBE_SECONDS` aceita 3–30 s (padrão 4); `SMG_PROBE_WIDTH`/`SMG_PROBE_HEIGHT` permitem até 1920×1080. O probe não testa WGC, jogo, áudio, replay, rede, compositor físico nem qualidade visual de cenas complexas. A bola móvel tem baixa complexidade; upload sintético também adiciona trabalho. `cadenceTargetMet` apenas informa ≥90% da meta neste intervalo curto.

Primeira rodada: `output/playwright/native-cadence-2026-10-02T12-28-09-937Z/report.json`.

| Encoder | Meta | Saída observada |
| --- | ---: | ---: |
| NVENC | 60 | 60,1 FPS |
| NVENC | 120 | 119,9 FPS |
| Media Foundation | 60 | 60,2 FPS |
| Media Foundation | 120 | 120,2 FPS |
| x264 CPU | 60 | 52,3 FPS |
| x264 CPU | 120 | 120,1 FPS |

Não interpretar a divergência CPU 60/120 como limite da CPU: casos curtos podem conter inicialização/drenagem. Precisa de repetições mais longas. Nesta rodada houve recompilação de 8,9 s **antes** dos pipelines; o resumo de recursos da execução inteira inclui esse custo e não representa apenas encode. Os pipelines são sequenciais, sem compilação simultânea.

Correlações de PTS entrada/saída não produziram pares válidos nesta máquina: duração interna do segmento de encode aparece `null`. Não usar esse campo para decompor latência. Contagem dos buffers timestampados e FPS continuam disponíveis.

NVENC/MF conseguiram aproximadamente 120 FPS isolados. Isso enfraquece a hipótese de um teto inevitável de 60 FPS nesses encoders para esta carga simples. Não localiza sozinho um eventual teto na captura/composição do desktop: ainda faltam probes equivalentes no worker que captura a janela real.

Repetição em `output/playwright/native-cadence-2026-10-02T12-48-06-094Z/report.json`, agora com hashes e janelas aproximadas de recursos por caso: NVENC 60,06/120,16; MF 60,28/120,15; CPU 60,04/120,13 FPS. Todos cumpriram a meta curta de cadência. A oscilação anterior de CPU não reapareceu, reforçando que aquele resultado isolado não definia um limite. Novamente houve compilação antes dos pipelines; usar recursos por caso, não o resumo global com startup/compilação. As janelas são alinhadas à chegada do resultado no Node, incluem drenagem/parada e contêm apenas três amostras de 1 Hz; não são caracterização de desempenho sob jogo.

## Calibração de instrumentação

```powershell
npm run test:e2e:instrumentation -- --repeat 3 --seconds 60 --exe src-tauri/target/release/seemygame.exe --channel chrome
```

H.264, preset `ultra` (1280×720/60), aplicativo release, sem áudio/replay; óptica 0/8 Hz alternada em três repetições. Nenhum outro benchmark, Vitest ou compilação deve rodar durante os pipelines. Arquivo consolidado registra caminhos dos seis relatórios, FPS p10/p50, qualidade, carga externa e custo do instrumento. `--seconds` define intervalos totais, incluindo warmup/cooldown; duração efetiva está no relatório e pode exceder a nominal pelo trabalho de coleta.

Relatório: `output/playwright/instrumentation-2026-10-02T12-29-29-364Z/report.json`. Todas as seis entregas funcionaram e todas as seis **falharam** no gate de qualidade 720p60. O `status: passed` da matriz significa conclusão funcional, não homologação de qualidade.

| Mediana entre três rodadas | Óptica desligada | Óptica 8 Hz |
| --- | ---: | ---: |
| FPS decodificados p50 | 54,49 | 54,60 |
| FPS decodificados p10 | 53,49 | 53,85 |
| CPU total p95 | 69,8% | 69,0% |
| Engine GPU mais ocupado p95 | 6,89% | 6,95% |
| CPU externa p95 | 4,73% | 4,95% |
| CPU do coletor p95 | 0,52% | 0,52% |

Rodadas individuais: sem óptica, p50 54,12 / 54,49 / 54,55 FPS; com óptica, 54,73 / 54,36 / 54,60 FPS. Com óptica, latência visual p50 42 / 37 / 42 ms, p99 52 / 51 / 52 ms. Sem óptica não há medição de latência. Duração de amostras válidas do gate: aproximadamente 62–64 s por rodada, além do warmup/cooldown.

As consultas tiveram custo p95 entre 11,6 e 18,6 ms; leitura óptica individual p50 8,2–8,4 ms. CPU total p95 variou entre 56,3% e 88,0%; a rodada mais alta gerou aviso `high-system-cpu`. Carga externa p95 variou de 2,86% a 13,79%. Não foi um experimento com carga externa rigidamente constante.

A diferença de 0,11 FPS entre as medianas não demonstra vantagem de um modo. Desativar a óptica não levou a 60 FPS neste contexto; portanto, ela não explica sozinha esse teto observado. Não concluir que seu custo é zero, pois há variação de carga/ordem e o restante do harness permaneceu ligado.

Na terceira rodada sem óptica, o HUD nativo registrou cerca de 54 FPS **já no produtor RTP**, e o receptor acompanhou essa cadência, com 0 perdas/freezes/frames descartados na amostra final. A fonte sintética reportava 60 FPS. Isso concentra a investigação entre captura/composição, videorate, conversão e encode, antes da recepção. O encoder isolado a 120 FPS reduz a probabilidade de um teto intrínseco do NVENC nesta carga, mas não descarta interação com captura/GPU nem perdas anteriores ao RTP.

### Redução do volume do harness

Durante a bateria apareceu um custo adicional: a leitura de `sourceStats` copiava o `frameLog` completo pelo CDP e o duplicava para transmissor e receptor em todo checkpoint. Um relatório de rodada atingiu aproximadamente 40,7 MB; CPU Node p95 da primeira rodada ficou em 4,43% da máquina, enquanto o coletor estava em 0,52%.

Após concluir as seis rodadas, a coleta foi alterada para transmitir somente contadores pequenos durante a medição. O log completo da fonte é salvo uma vez por fase em `native-source.json`/`web-source.json`, após a coleta, preservando a prova de sequência/timestamp. As seis rodadas anteriores ficam preservadas com seus hashes; não são misturadas com resultados do harness reduzido.

Verificação separada: `output/playwright/instrumentation-2026-10-02T12-42-57-852Z/report.json`, uma repetição 0/8 Hz com `--seconds 70`, cerca de 67–68 s válidos no gate.

| Harness reduzido, uma rodada por condição | Óptica desligada | Óptica 8 Hz |
| --- | ---: | ---: |
| FPS decodificados p50 | 54,97 | 54,91 |
| FPS decodificados p10, timeline | 54,30 | 54,33 |
| Maior pausa, gate de apresentação | 72,8 ms | 24,4 ms |
| Gate de qualidade | Falhou na pausa | Passou nos critérios definidos |
| CPU do Node p95 | 2,86% | 2,35% |
| CPU externa p95 | 14,06% | 6,77% |
| Tamanho do report JSON | 19,56 MB | 19,71 MB |

Na rodada óptica, p50/p99 de latência visual foram 43/55 ms; 530 leituras válidas no steady. `native-source.json` preservou 4817/4831 entradas nas duas rodadas. A redução de tamanho/cópias foi efetiva, mas não comprova causalmente o ganho de aproximadamente 0,4 FPS frente à primeira bateria: duração, carga externa e número de repetições diferem. O gate aceita ≥90% da meta (54 FPS para meta de 60); aprovação de uma rodada **não significa 60 FPS cravados ou homologação geral**.

A matriz também exporta veredito agregado de entrega e qualidade; `--require-quality` pode exigir que todas as condições cumpram o gate. Use pelo menos `--seconds 70` para obter ≥60 s estáveis com warmup/cooldown e harness mais leve. Ainda permanece volume considerável de estatísticas/candidatos/checkpoints para uma próxima redução controlada do observador.

## Laboratório web com recursos

Comando: `node tools/e2e/quality-benchmark.mjs --channel chrome --profiles hd60 --codecs h264 --seconds 60 --require-quality`.

Resultado em `output/playwright/quality-2026-10-02T12-40-53-198Z/report.json`: entrega funcional aprovada; qualidade **reprovada**, saída do processo 1. Fonte canvas: 59,99 FPS; decode mediano 54,01 FPS; p10 do resumo 48,85 FPS; apresentação p10 47,86 FPS; maior pausa 467,1 ms. O gate opera nas amostras com decode e apresentação válidos e por isso seu p10 de decode foi 47,86 FPS, ligeiramente diferente do resumo que inclui todas as amostras de decode. Codec efetivo H.264, resolução 1280×720.

CPU total p50/p95 14,54%/52,46%; núcleo p95 73,82%; engine GPU p95 6,39%; CPU externa p95 17,20%. Coletor: consulta p95 8,88 ms, CPU p95 0,26%; nenhuma amostra descartada, intervalo p95 1001 ms. O resumo também detalha cada engine GPU e grupo de processos.

Este laboratório usa canvas `captureStream` e dois peers na mesma página, headless; não usa `getDisplayMedia`, janela WGC ou jogo. Não comparar esses FPS diretamente com as rodadas de captura nativa como se fosse A/B equivalente, nem atribuir a pausa à carga externa sem correlação temporal e controle da carga. Sua utilidade aqui foi validar o gate real de falha e o coletor no fluxo web.

## O que permanece necessário

1. Medir etapas da captura real no worker: frames produzidos pelo WGC, conversão, entrada/saída do encoder, filas e timestamps. O probe sintético não substitui isso.
2. Repetir com áudio × replay (matriz 2×2), isolando alterações de cadência e sincronismo A/V.
3. Usar duas máquinas; jogo sem limite de FPS versus limite, mesmas cenas; incluir rota LAN e externa. A óptica com `Date.now()` exige relógios calibrados entre máquinas antes de comparar latência absoluta.
4. Testar restrição de banda/perda/RTT e renegociação/fallback. Registrar bitrate solicitado, aplicado e efetivamente enviado, incluindo falha de `setParameters`.
5. Tornar fallback solicitado → codec efetivo explícito na interface. Não homologar AV1/HEVC/120 somente por capabilities ou sucesso funcional.
6. Estimar interferência do restante do harness: leituras CDP, volume de dados/JSON, escrita de checkpoints e HUD; o coletor de recursos é apenas uma parte do observador.

Nenhuma fila RTP comprimida deve receber descarte arbitrário só para baixar latência: é necessário considerar fragmentos do mesmo frame e recuperação de decodificação.

## Validação automatizada

Suíte completa antes das rodadas: 930 testes/91 arquivos aprovados; subset após redução do harness: 72 testes/3 arquivos aprovados; suíte final: **931 testes/91 arquivos aprovados** (`output/playwright/resources-final-tests.log`). Debug e release compilados; o teste Rust de capacidade compilou e executou duas baterias de seis casos. Grafo de 162 módulos/419 imports validado. Os testes novos cobrem CPU por núcleo, resets/topologia/PID reutilizado, atribuição de processos, agregação correta de engines GPU, ausência de métricas, critérios de duração/FPS/codec e coleta pequena que preserva o frameLog original.

Os resultados E2E de qualidade reprovados acima são achados de desempenho, não erros escondidos por uma aprovação funcional. Perfis 120 continuam experimentais; a etapa sintética isolada não modifica essa classificação.
