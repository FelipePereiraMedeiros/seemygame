# Quinto parecer — último teste de isolamento

Artefato: `output/isolation-battery/2026-09-18T19-27-47-944Z/isolation-report.json`, executado em 18/09/2026, aproximadamente 16:27–16:32 de Brasília. Código revisado: `5c9a437`. Revisão de dados existentes; sem novo benchmark ou alteração do pipeline.

## Parecer executivo

A instrumentação avançou e o desempenho observado melhorou. Dois cenários passaram no orçamento atual, três ficaram degradados e dois falharam; áudio por processo foi ignorado por falta de suporte reportado pelo backend. Ainda não é aprovação geral de estabilidade, áudio audível ou latência.

O executável tem o mesmo SHA256 da rodada de 15:46 UTC. Os hashes atuais da fixture, telemetria e executor correspondem aos registrados. Nesta comparação não há evidência de troca de binário nativo: as melhorias observadas não devem ser apresentadas como efeito comprovado de uma otimização nova do pipeline Rust. Fonte, instrumentação e condições entre execuções continuam variáveis.

## Resultados

| Cenário | Qualidade | FPS médio | FPS p10 | Maior gap RVFC | Gaps >100 ms |
|---|---|---:|---:|---:|---:|
| Controle A/V, prévia ligada | DEGRADED | 53,4 | 50,4 | 103 ms | 7 |
| Prévia suspensa | PASSED | 55,3 | 53,2 | 103 ms | 1 |
| Player mutado | FAILED | 50,2 | 41,4 | 1.266 ms | 10 |
| Vídeo puro | PASSED | 56,3 | 53,4 | 103 ms | 1 |
| Jitter solicitado 0 ms | DEGRADED | 53,2 | 49,3 | 106 ms | 4 |
| Jitter solicitado 25 ms | FAILED | 51,3 | 40,5 | 1.279 ms | 3 |
| Jitter padrão | DEGRADED | 53,1 | 49,0 | 103 ms | 4 |

Fases de aproximadamente 25 s ou 20 s, uma execução de cada condição, em ordem fixa. Todos os sete cenários executados têm validade experimental VALID pelas invariantes implementadas. Todos reportam zero pacotes de vídeo perdidos. PASSED significa atender ao orçamento do executor, não 60 FPS perfeitos nem ausência de pausas perceptíveis.

## Pendências atendidas

- Fonte: cadência efetiva entre 59,95 e 60,01 FPS, layout observado 1920×1080 e DPR 1. Os intervalos finais têm p95/p99 perto de 24 ms; o máximo acumulado fica perto de 24 ms, sem deadlines perdidos reportados. A fonte é regular o suficiente para enfraquecer a hipótese de que as pausas de 1,2 s começaram no seu loop de desenho. Isso não verifica quando o compositor efetivamente exibiu cada desenho.
- Agora existem resultados separados de execução, validade e qualidade, com motivos explícitos para FAILED/DEGRADED.
- O mute global foi documentado nos nomes e argumentos do navegador. O teste não é mais apresentado no título como prova de saída audível.
- A seleção de inbound RTP removeu o fallback silencioso para outra trilha.
- Contadores brutos de decode e keyframes foram preservados. Recalculei 153 amostras de decode a partir dos deltas: todas coincidem exatamente com o valor publicado.

## Interpretação das hipóteses

### Prévia e áudio: pistas, não causas demonstradas

Suspender a prévia trouxe +1,9 FPS e reduziu gaps de 7 para 1 nesta rodada. É uma pista favorável, porém o resultado da rodada anterior não foi consistente com esse benefício. Repetições alternadas são necessárias para separar efeito da intervenção de variabilidade entre sessões.

Vídeo puro atingiu 56,3 FPS, contra 53,4 no controle A/V. Há contribuição possível do caminho de áudio/sincronização/carga, mas o controle já ficou bem mais estável. O cenário player mutado manteve uma pausa de 1.266 ms; isso não prova que mutar o player cause o problema.

### Jitter: zero e padrão praticamente empatam

Zero e padrão ficaram em 53,2/53,1 FPS, com quatro gaps cada. Não há vantagem robusta demonstrada entre eles. O cenário de 25 ms falhou por uma pausa longa, mas uma única execução não estabelece causalidade.

O jitter de áudio observado permaneceu entre 83,9 e 86,9 ms nos cenários A/V. Readback do alvo não equivale ao atraso efetivo. É preciso guardar também contadores brutos de jitter, concealment e correções de amostras para investigar áudio, além de medir sincronismo A/V.

### Decode: a conta está correta; a causa permanece desconhecida

As médias ficam entre 112,3 e 136,9 ms, mesmo nos cenários aprovados. Os contadores confirmam a aritmética, mas `decoderImplementation` continua unknown e `powerEfficientDecoder` é null. Isso não prova uso de decoder por software, saturação da GPU ou latência total de 130 ms.

Próxima investigação: conservar stats completos com identidade do peer, tempos e contadores de frames recebidos/descartados, freezes, NACK/PLI e envio; correlacionar com filas/encode no host e atividade da GPU. Não transformar média de decode em decomposição causal do atraso visual.

## Problemas restantes no executor

1. **Mute por processo é apenas metadado.** O navegador é aberto uma única vez com `--mute-audio`. O cenário de áudio por processo declara `browserGloballyMuted:false`, mas o executor não relança o navegador sem a flag. Esse ramo foi corretamente ignorado nesta máquina, cujo backend reporta `supports_process_audio:false` e Windows build 19045. Em máquina compatível, o relatório poderá alegar saída desmutada sem efetivamente implementá-la. Corrigir antes de usar esse cenário como prova de áudio audível.
2. **Orçamento não normaliza duração.** O limite absoluto de gaps é o mesmo para fases de 20 e 25 segundos. Usar eventos/minuto, severidade e duração total congelada. Registrar dados ausentes como desconhecidos, especialmente perda de pacotes, em vez de convertê-los automaticamente em zero.
3. **Intervalos da fonte ainda não são validados continuamente.** p95/p99 usam somente os últimos 120 intervalos; o máximo é acumulado desde o reset anterior ao warmup. Separar janela de warmup/coleta e registrar estatísticas por intervalo. `missedDeadlines` conta eventos de atraso, não o número de slots perdidos.
4. **Coleta bruta ainda parcial.** Há bons contadores de decode, mas faltam no relatório vários campos que a telemetria já sabe ler, como framesDropped, freezes, NACK/PLI e correções/concealment de áudio. Vincular codec por pcId e codecId, evitando procurar apenas pelo id em stats de múltiplos peers.

## Próximo passo recomendado

Antes de novas mudanças de produção, repetir controle, prévia suspensa e vídeo puro em ordem alternada, 3–5 vezes por pelo menos 60 segundos. Priorizar captura de evidências durante as pausas de 1,2 s, com stats completos e filas do host. Depois repetir jitter. Usar outro endpoint/máquina ou implementar corretamente o cenário de áudio por processo para reprodução audível.

Não há glass-to-glass, A/B com web nem carga de jogo nesta rodada. Portanto, a conclusão sustentável é melhora observada da estabilidade e do diagnóstico, com falhas intermitentes ainda presentes — não redução comprovada de delay nem superioridade do nativo.
