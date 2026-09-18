# Revisão do diagnóstico E2E — 17/09/2026

## Parecer

O coletor reúne dados úteis, mas o resultado `passed` da execução `2026-09-17T06-25-06-316Z-61a567` não valida a medição óptica nem um comparativo controlado. As conclusões de superioridade nativa, custo total da ponte de 2,05 ms e latência visual de 2,892/3,789 segundos não estão sustentadas. Esta revisão inspecionou módulos atuais, JSON e screenshots dessa execução, sem iniciar nova captura.

## Achados prioritários

### D01 — P1: fonte errada e comparação sem equivalência

`tools/e2e/run.mjs` seleciona o primeiro monitor ou primeiro item, substituindo a seleção da janela sintética. O JSON confirma `sourceType: monitor`, `sourceId: capture_1_monitor_3`; não comprova monitor primário. `viewer-native.png` mostra wallpaper/ícones do desktop, não a animação. `desktop-web.png` mostra fundo verde com quadrados, também sem o marcador esperado. As flags de dispositivos falsos estão habilitadas e não existe validação de proveniência da track de display. A imagem verde é compatível com mídia sintética de navegador, mas o relatório não registra informação suficiente para concluir a origem exata.

Além disso, a fase nativa transmite WebView2 → Chrome, enquanto a fase web transmite Chrome → WebView2. Mudam transmissor, receptor e fonte; codec, resolução, replay e taxa da fonte não são impostos igualmente. Os 40,24 versus 19,88 FPS descrevem essas duas execuções, não o ganho isolado do método de captura. Não repetir automaticamente esta versão antes de restaurar a seleção exclusiva da fonte sintética.

### D02 — P1: leituras ópticas inválidas são aceitas como latência

O final nativo contém 249 callbacks, 248 duplicados e `lastSeq: 32768`, enquanto a fonte relata apenas 968–2232 frames durante a fase. No web, todos os percentis ópticos, mínimo e máximo são exatamente 3789 ms; não se registra quantas leituras os sustentam. As imagens não mostram a fonte e não há associação entre sequência decodificada e frames efetivamente produzidos. Esses valores devem ser classificados como inválidos/inconclusivos.

O decoder busca preâmbulo de quatro bits e XOR de oito bits em muitas posições, retornando o primeiro candidato. XOR não é à prova de falsos positivos: reprodução offline com o encoder/decoder reais alterou dois bits do campo de sequência, transformando 1420 em 34060, sem rejeição do checksum. Não há magic/session ID forte, confirmação temporal ou contagem de candidatos rejeitados.

O coletor também descarta silenciosamente idades fora de `[-50, 5000)` ms. A latência nativa termina em 4992 ms, próxima ao corte, e `recentP50` permanece congelado em 3708 mesmo quando novas amostras deixam de entrar. Percentis de uma distribuição truncada e sem validade temporal não podem produzir um veredito. Timestamp de 16 bits é ambíguo após wrap e exige associação temporal externa.

### D03 — P1: o encoder web medido é de uma conexão sem tráfego

As consultas usam `.find()` pelo tipo/kind, sem vincular peer, track e conexão ativa. No último sample web, PCs 7 e 10 estão `connecting`, com zero frames; PC 11 está `connected`, com 207 frames codificados e encoder NVIDIA H.264. O coletor escolhe o primeiro e publica `outboundEncodeTimeMs: null` e bitrate zero.

O dado existe: os nove deltas do PC 11 têm média aritmética de aproximadamente 7,15 ms/frame, último intervalo 6,62 ms. Isso não é uma comparação corrigida completa, mas prova que “embutido no browser” é uma interpretação incorreta de dado ausente. Corrigir associação por peer/track/SSRC e invalidar amostras obsoletas antes de qualquer cálculo.

### D04 — P1: tempo de decode é apresentado como custo total da ponte

`bridgeCostMs` recebe somente a média de `bridge.decodeTimeMs`. O próprio JSON apresenta jitter buffer da ponte de 179,03 ms no início e aproximadamente 18,85–34,02 ms nos intervalos seguintes. O custo de captura, encode nativo, transporte local, filas e apresentação não é medido por esse número. Tampouco pode ser descartado como gargalo.

Um sinal que merece investigação está no receptor Chrome da fase nativa: deltas de decode de aproximadamente 150–160 ms/frame em vários intervalos. É necessário correlacionar implementação do decoder, carga, atraso do callback e intrusão da instrumentação antes de atribuir causa.

### D05 — P2: contadores de apresentação e stutter usam a semântica errada

`presentedFrames++` conta callbacks JS, ignorando `metadata.presentedFrames`. Callbacks podem deixar de ocorrer entre frames apresentados. O código também ignora `expectedDisplayTime`, `presentationTime` e duração do trabalho de análise; mede `Date.now()` depois de copiar pixels e fazer a busca. Isso não mede o instante físico de exibição do monitor.

`maxPauseMs` é cumulativo. Uma pausa inicial de 393 ms faz todos os cinco intervalos estáveis nativos serem classificados como stutter, mesmo sem nova pausa equivalente. Os testes `if (fps && fps < 30)` ignoram FPS zero. O limiar fixo de 30 FPS também confunde perfil/cadência normal com falha. A árvore deve produzir hipóteses com evidências e confiança, não causa-raiz comprovada.

### D06 — P2: testes não cobrem o decoder efetivamente injetado

Existem implementações duplicadas no módulo óptico, no `installTelemetry` e na fonte HTML. Os testes importam o módulo óptico, mas não validam o decoder injetado. O teste chamado “checksum inválido” usa largura 400: um marcador padrão exige 528 pixels, portanto retorna antes de verificar checksum. O suporte a blocos de 24 pixels exige pelo menos 1056 pixels, incompatível com o recorte de largura máxima 1000 do coletor. Também faltam imagens sem marcador, corrupção pareada, escalas fracionárias, offsets, fonte errada e cobertura mínima de leituras válidas.

### D07 — P2: overhead, fases e métricas ausentes não são controlados

A alegação de leitura óptica abaixo de 0,2 ms não tem medição no código/JSON. Há cópia de até 1000×200 pixels e busca em várias posições a cada callback, em cada vídeo instrumentado. Registrar duração p50/p95/p99 e comparar instrumentação ligada/desligada é necessário.

A timeline atribui warmup/steady/cooldown por índice, mas o resumo de FPS e os percentis ópticos incluem todas as fases. Coleta sequencial mais `sleep(1000)` não garante intervalo de exatamente um segundo; faltam timestamps por camada no resumo. Memória livre global não mede consumo dos processos nem equivalência de recursos. Campos ausentes convertidos em zero/`none` mascaram falhas. A coleta durante espera inicial pelo vídeo foi removida em relação à versão anterior.

## Correções e testes de aceitação propostos

1. Fonte exclusiva com ID da execução codificado no marcador; validar identidade e progressão da sequência recebida contra um registro dos frames produzidos. Falhar sem cobertura suficiente, sem substituir a janela por monitor/primeiro item.
2. Um único encoder/decoder óptico, magic mais longo e CRC adequado. Testar imagens sem marcador, corrupção, escalas/offsets e wraps. Nenhum checksum elimina todo falso positivo; confirmar também proveniência e continuidade.
3. Publicar contagens de leitura válida/rejeitada, última leitura, idade da métrica e motivo de invalidação; não truncar silenciosamente atrasos. Separar limite de validade de meta de performance.
4. Vincular vídeo → track → peer connection → SSRC e testar múltiplas conexões, incluindo conexões antigas sem frames. Ausência de dados deve gerar `null`/inconclusivo.
5. Usar metadata de apresentação, deltas de pausas e métricas de duração da instrumentação. Testar uma pausa no warmup sem replicá-la nos intervalos seguintes e FPS zero sem perder o diagnóstico.
6. Manter o mesmo receptor e fonte nas duas fases; registrar perfil/codec/implementação reais e replay. Se for necessário mudar o runtime transmissor, declarar esse fator. Repetir A/B e B/A com aquecimento e período estável separado.
7. Só emitir veredito comparativo se ambos os lados passarem critérios de proveniência, completude e equivalência. Distinguir `functionalPassed`, `measurementValid` e `performancePassed`.

## Interpretação numérica

O JSON armazena **2892 ms e 3789 ms**, não 2,892 ms e 3,789 ms no sentido decimal. A diferença é 897 ms; se as medições fossem válidas, a redução relativa à latência web seria **23,7%**, não 31%. Como a medição óptica falhou nos critérios acima, nem esse ganho pode ser afirmado agora. Ausência de perdas RTP reportadas tampouco equivale a transporte “100% íntegro”.

## Referências técnicas

Validação executada nesta revisão: a suíte `npm test` terminou com sucesso; o relatório completo foi gravado em `docs/resultados-revisao-diagnostico-e2e-2026-09-17.json`. A reprodução offline de corrupção de dois bits usou as funções reais do módulo óptico. Não foram alterados os módulos de captura/telemetria nesta revisão; os problemas acima permanecem para correção.

- [W3C WebRTC Stats](https://www.w3.org/TR/webrtc-stats/): distingue tempo acumulado de decode e tempo de residência no jitter buffer.
- [Especificação requestVideoFrameCallback](https://wicg.github.io/video-rvfc/): define `presentedFrames`, `expectedDisplayTime` e a possibilidade de callbacks perdidos/atrasados.
