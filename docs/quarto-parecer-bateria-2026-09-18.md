# Quarto parecer — fonte corrigida, estabilidade ainda pendente

Revisão em 18/09/2026 do relatório `output/isolation-battery/2026-09-18T15-46-11-036Z/isolation-report.json` e do código no commit `3fe3741`. Não foram executadas novas transmissões nem alterado o pipeline nesta revisão.

## Parecer

A rodada passou a cumprir a cadência média pretendida: 59,98–60,02 FPS nos sete cenários. O canvas agora possui backing store 1920×1080, relógio monotônico e reset. O diagnóstico anterior de fonte a 165 FPS foi atendido. A estabilidade recebida melhorou em relação ao artefato anterior, mas persistem pausas de até 2,08 segundos. Não há evidência de solução completa nem medição de latência ponta a ponta nesta bateria.

Os hashes atuais da fixture e do executor correspondem aos registrados no relatório. A execução ocorreu em checkout dirty baseado em `648d586`, antes do commit que consolidou as alterações. O executável também mudou de hash em relação à rodada anterior: não atribuir toda diferença de resultado apenas ao limitador da fonte.

## Resultados

| Cenário | Fonte FPS | Recepção FPS médio | FPS p10 | Maior gap RVFC | Gaps >100 ms |
|---|---:|---:|---:|---:|---:|
| A/V, prévia ligada | 59,98 | 47,9 | 44,4 | 198 ms | 20 |
| A/V, prévia suspensa | 60,02 | 45,8 | 43,2 | 1.164 ms | 15 |
| A/V, player mutado | 59,98 | 47,0 | 45,1 | 2.080 ms | 11 |
| Vídeo puro | 60,02 | 53,9 | 51,2 | 287 ms | 5 |
| Jitter solicitado 0 ms | 60,00 | 51,3 | 48,1 | 106 ms | 11 |
| Jitter solicitado 25 ms | 59,98 | 51,1 | 47,2 | 1.443 ms | 8 |
| Jitter padrão | 60,02 | 48,2 | 44,2 | 782 ms | 8 |

Os quatro primeiros cenários duram aproximadamente 25 s; os demais, 20 s. Contagens de gaps exigem normalização por duração. São gaps entre callbacks, não localização causal do engasgo nem medição física do painel. Todos os cenários estão VALID pelas invariantes implementadas; isso não equivale a aprovação de qualidade.

## Pendências prioritárias

### P1 — O cenário denominado audível inicia com mute global

O executor adicionou `--mute-audio` ao navegador espectador para evitar recaptura pelo loopback de sistema. Entretanto, continua classificando os controles como audíveis e valida somente `video.muted`, `video.volume`, trilha e progressão dos dados recebidos. Volume 1 no elemento não demonstra saída audível quando o navegador foi iniciado com mute global.

A comparação controle versus player mutado ainda altera o estado do elemento, mas não comprova a comparação saída física ativa versus inativa. Renomear a condição como saída globalmente silenciada e registrar os argumentos de lançamento. Para testar reprodução real sem recaptura, usar espectador em outra máquina ou endpoint não capturado; validar o roteamento. Não inferir desta revisão que o mute global elimina o processamento ou a sincronização A/V: isso também requer observação.

### P1 — As métricas de qualidade ainda não reprovam pausas graves

A separação `executionStatus`/`validityStatus` é um avanço, mas falta um resultado de qualidade. Um cenário com pausa de 2.080 ms recebe VALID porque satisfaz o desenho atual das invariantes. Acrescentar orçamento explícito de FPS, pausas, frames descartados e latência, mantendo validade experimental e desempenho como resultados distintos.

### P2 — Cadência média correta não prova espaçamento uniforme

A fixture incrementa `plannedFrames` e `drawnFrames` no mesmo ramo: os contadores são necessariamente iguais e não permitem observar deadlines perdidos. O agendador só reposiciona o alvo quando o atraso ultrapassa 100 ms. Após atrasos menores, pode desenhar em vários rAF consecutivos para alcançar a agenda, produzindo rajadas em monitor de alta frequência.

Registrar intervalos reais entre desenhos, p95/p99, atraso em relação ao deadline e slots perdidos. Calcular os frames planejados a partir do relógio. Validar a fonte durante toda a coleta, não apenas FPS inicial/final e média agregada. Também conferir o tamanho efetivamente visível da janela e do canvas; as dimensões nativas retornadas pela API são constantes.

### P2 — Jitter configurado não corresponde ao atraso observado

O cenário 0 ms registra readback zero em áudio e vídeo, mas a média das amostras de jitter de áudio é aproximadamente 86,8 ms. No cenário 25 ms, é aproximadamente 86,0 ms. O vídeo registra aproximadamente 8,3 e 8,6 ms, respectivamente. Logo, os dados não sustentam que igualar os valores configurados iguale o comportamento efetivo das trilhas.

O cenário 0 ms tem a menor pausa máxima nesta execução, mas FPS semelhante ao de 25 ms (51,3 versus 51,1). Uma execução curta e sequencial não define política vencedora. Repetir com ordem alternada e medir qualidade de áudio e sincronismo, além de vídeo.

### P2 — Decode alto permanece sem localização do gargalo

A média reportada de decode varia de 116,1 a 137,0 ms. A fórmula usa delta de totalDecodeTime dividido pelo delta de framesDecoded; não há troca aparente de unidade no cálculo. Contudo, o relatório consolidado não conserva os contadores brutos necessários para revalidar cada amostra nem identifica o decoder utilizado.

Guardar stats brutos com pcId, SSRC, trackIdentifier, codec e implementação do decoder quando disponíveis. Remover o fallback silencioso para a primeira linha inbound de vídeo se a trilha esperada não for encontrada. Coletar também captura, encode, filas e GPU. Não somar essa média aos buffers para reconstruir uma latência ponta a ponta que não foi medida.

## Interpretação e próxima bateria

Vídeo puro alcançou 53,9 FPS contra 47,9 no controle A/V, com menos gaps. É uma pista de contribuição do caminho de áudio/sincronização ou da carga adicional, não prova de causa. Suspender prévia e mutar o player não demonstraram benefício consistente.

1. Corrigir a nomenclatura/condição de áudio e adicionar resultado de qualidade.
2. Instrumentar espaçamento da fonte e stats brutos do receptor; testar o agendador com pausas simuladas de 30–90 ms e monitores de 60/144/165 Hz.
3. Repetir controle A/V e vídeo puro por pelo menos 60 s, 3–5 vezes, alternando ordem. Incluir áudio por processo: a opção entrou na interface, mas esta bateria usa somente system/none.
4. Comparar jitter apenas depois de estabilizar fonte e saída de áudio; registrar underruns/concealment e marcador sincronizado de áudio/vídeo.
5. Retomar medição óptica e comparação nativo/web sob a mesma carga de jogo. Estes sete cenários são nativos e não demonstram superioridade frente ao web nem proximidade do limite mínimo de delay.
