# Parecer das últimas rodadas — 18/09/2026

Revisão dos artefatos existentes e do código atual do executor. Não foi executado novo benchmark nem alterado o pipeline. Os relatórios de isolamento não preservam hash do executor/binário; por isso, o código atual não comprova exatamente qual versão rodou em cada execução anterior.

## Parecer

Os dados mostram transmissão funcional, mas não demonstram estabilidade nem resolução da causa dos engasgos com áudio. Há degradação relevante na última rodada e falhas de isolamento que impedem atribuí-la exclusivamente ao áudio, à prévia ou ao jitter buffer.

## Último isolamento com YouTube

Fonte: `output/youtube-isolation/2026-09-18T06-28-59-147Z/isolation-report.json`.

| Cenário declarado | FPS médio | FPS p10 | Decode médio por intervalo | Jitter de vídeo médio |
|---|---:|---:|---:|---:|
| Vídeo sem áudio | 57,3 | 50,1 | 56,6 ms | 7,9 ms |
| Áudio capturado / espectador mutado | 49,3 | 41,5 | 114,4 ms | 3,3 ms |
| Prévia pausada | 47,6 | 16,8 | 121,6 ms | 8,8 ms |
| Hint de playout 0 ms | 45,4 | 0 | 61,5 ms | 4,2 ms |
| Hint de playout 25 ms | 54,2 | 51,6 | 134,7 ms | 10,0 ms |
| Hint de playout default | 56,0 | 53,4 | 127,9 ms | 10,4 ms |

São médias de amostras, não medições glass-to-glass. O relatório não guarda latência visual, identificação do decoder, resolução efetiva nem snapshots brutos completos. Há intervalos com FPS zero nas fases 2, 3 e 4A. Zero perda reportada não equivale a vídeo estável; o executor também transforma ausência de `packetsLost` em zero.

Nas rodadas anteriores, vídeo puro teve média de 60,0 / 54,8 / 59,4 FPS, contra 57,3 agora. Com áudio, 58,7 / 57,2 / 57,7 FPS, contra 49,3 agora. Pausar a prévia ora melhora, ora piora: não há ganho consistente demonstrado. A execução 05:55 tem métricas centrais nulas em todas as fases; em 06:24, os três subtestes de jitter têm FPS/decode nulos. Essas fases são inconclusivas, não aprovações.

## Problemas do instrumento

1. **Contadores atravessam fases.** `collectMetrics()` limpa apenas o mapa de deltas RTP; `sample()` lê apresentação com `reset:false`. Na última execução, os gaps começam/terminam em 0→3, 3→9, 9→16, 17→19, 20→21 e 21→24. A pausa de 9.204 ms reaparece nos três subtestes finais. O máximo inclui histórico e potencialmente os intervalos intencionais de parada/reinício. Não tratar esses valores como freezes individuais em cada fase. Criar baseline por sessão e rearmar o relógio do callback após troca de stream.
2. **Cenas diferentes.** O vídeo avança para 25, 65, 105 e 145 segundos; os subtestes de jitter seguem sequencialmente. Complexidade visual, buffering e estado térmico mudam junto com a variável estudada. Repetir o mesmo trecho e alternar a ordem.
3. **Áudio mutado não é validado.** A alteração ocorre antes de iniciar a nova captura, quando o elemento pode não existir ou ser substituído. A rotina de espera também clica em unmute. Não há snapshot posterior de `muted`, `volume`, tracks e estado de reprodução. Mutar a saída, por si só, não comprova remoção do processamento/sincronização de áudio.
4. **Prévia pausada não significa decoder desligado.** O teste apenas chama `pause()` e reduz a opacidade do elemento. Não encerra o peer de prévia nem verifica se `framesDecoded` deixa de crescer. A experiência atual testa a pausa do elemento, não a remoção comprovada do custo do decode.
5. **Experimento de jitter incompleto.** Modifica somente `playoutDelayHint`; o produto também configura `jitterBufferTarget` em 25 ms com áudio. Não registra suporte, valores lidos de volta ou receivers afetados. Portanto, “default” não comprova retorno de todas as políticas ao padrão. Medir alvo solicitado, alvo efetivo e residência observada separadamente.
6. **Seleção ambígua de streams.** Usa o primeiro inbound de vídeo/áudio e o primeiro vídeo ativo, sem associação explícita com peer/track do host. O canal de voz pode confundir a seleção do áudio. Vincular PC, SSRC, track e elemento.
7. **Busca óptica desnecessária no YouTube.** `expectedSessionMagic:null` não desliga a leitura de pixels. Sem marcador, o fallback continua buscando-o a cada oportunidade de amostragem, com `drawImage/getImageData`. Desabilitar leitura óptica nesta suíte e conservar apenas stats/RVFC; medir o custo separadamente.
8. **Proveniência e validade insuficientes.** Faltam hashes, versões, resolução real, fonte FPS/qualidade, cronologia absoluta e cobertura das amostras. Um loop de 30 amostragens não comprova 30 segundos, pois coleta e esperas se somam. Falta reprovar/inconcluir quando métricas ficam nulas.

## Último E2E sintético

`output/playwright/2026-09-18T05-40-51-666Z-2acbc7/report.json`: release, nativo 1920×1080, sem áudio, modo single. A tentativa anterior falhou por build desatualizado; esta passou na verificação do frontend embarcado.

- FPS mediano steady: 32,83; p10: 28,30.
- Latência visual steady: p50 175 ms; p90 203 ms; p99 205 ms.
- Apenas 3 intervalos steady e 18 amostras ópticas steady.
- Três intervalos com stutter; pausas de 483, 608 e 390 ms.
- Overhead óptico acumulado: p50 18,7 ms / p95 44,8 ms.

O `performancePassed:true` não valida qualidade: `run.mjs` aprova quando `--min-fps` está no padrão zero, sem critério de latência ou congelamentos. Comparado ao anterior 1080p (55,14 FPS / 182 ms), a cadência caiu e a latência ficou próxima. Build, duração e coleta diferem; não é uma regressão causal comprovada, nem evidência de otimização. A medição é curta e perturbada demais para sustentar um p99 robusto.

O tempo reportado de decode inclui a espera até a entrega do frame pelo decoder; não é necessariamente tempo exclusivo de GPU e não deve ser chamado de latência ponta a ponta. Referência: https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-totaldecodetime

## Próxima bateria recomendada

1. Corrigir validade, contadores, seleção de tracks e confirmação das intervenções antes de ajustar mais o pipeline.
2. Usar o mesmo trecho local conhecido, com áudio e vídeo sincronizados, resolução e FPS registrados. YouTube permanece teste complementar de uso real.
3. Comparar vídeo puro; A/V com som confirmado; A/V com saída mutada confirmada; A/V sem conexão de prévia. Manter replay fixo e documentado.
4. Rodar políticas de buffer em sessões independentes, verificando todas as propriedades suportadas e reportando ausência de suporte.
5. Coletar 60 s steady por cenário, 3–5 repetições em ordem alternada, com fonte/receptor/build fixos. Depois repetir sob carga de jogo e em receptor separado.
6. Guardar FPS de captura/encode/decode/apresentação, freezes por fase, áudio recebido/concealment, sincronismo A/V, filas e uso de GPU por engine. Medição óptica em bateria própria, com controle sem instrumentação.
7. Separar aprovação funcional, validade da medição e aprovação de desempenho. Sem orçamento definido, desempenho deve constar como não avaliado.

Não há base nestas rodadas para declarar o problema de áudio resolvido, escolher 25 ms como melhor política, afirmar que pausar a prévia elimina seu custo ou concluir que o nativo superou o web: a suíte YouTube não tem fase web comparativa.
