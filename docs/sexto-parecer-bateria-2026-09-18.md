# Sexto parecer — estabilidade, áudio e contadores de startup

Rodada: `output/isolation-battery/2026-09-18T20-43-01-325Z/isolation-report.json`, 18/09/2026, 17:43–17:51 de Brasília. Código atual: `72b13bd`. Revisão de artefatos; não foi executada nova transmissão nem alterado código de produção.

## Parecer

A fonte permanece estável e as repetições alternadas reforçam a hipótese de custo da prévia. Porém, o classificador mistura freezes anteriores à primeira amostra com qualidade da janela steady. A nova telemetria também revela uma pendência importante de áudio: aproximadamente 34–36% de concealed samples nos cenários A/V. Os três cenários de jitter não chegaram a reproduzir o stream e são inconclusivos para comparação de políticas.

O executável é o mesmo das duas rodadas anteriores (SHA256 iniciado em 373f91ca). Os hashes atuais da fixture, telemetria e executor coincidem com os do relatório. Portanto, não atribuir os resultados a uma nova otimização do binário Rust.

## Resultados observados

| Cenário | FPS médio | Maior gap RVFC | Gaps >100 ms | Qualidade publicada |
|---|---:|---:|---:|---|
| Controle, repetição 1 | 53,9 | 104 ms | 1 | FAILED |
| Prévia suspensa, repetição 1 | 55,8 | 103 ms | 2 | PASSED |
| Vídeo puro, repetição 1 | 57,1 | 104 ms | 1 | FAILED |
| Vídeo puro, repetição 2 | 57,2 | 0* | 0 | PASSED |
| Prévia suspensa, repetição 2 | 56,8 | 0* | 0 | FAILED |
| Controle, repetição 2 | 53,4 | 104 ms | 2 | FAILED |
| Player mutado | 53,7 | 104 ms | 3 | FAILED |

*Zero significa ausência de gap acima de 100 ms registrado pelo instrumento, não intervalo zero entre frames. Todos os cenários medidos duraram aproximadamente 20 s. Áudio por processo foi ignorado por capacidade indisponível; jitter 0/25/padrão falharam na inicialização.

## P1 — Congelamentos anteriores estão reprovando a janela steady

Em `test-deterministic-battery.mjs:959`, o resumo usa os últimos valores cumulativos de freezeCount e totalFreezesDuration, sem descontar uma baseline após warmup. O reset do instrumento de apresentação não zera os contadores do peer.

Nos cinco cenários reprovados com telemetria, o congelamento de 1,757–1,879 s já está presente na primeira amostra e permanece inalterado até a última. A variação entre essas amostras é zero em TODOS os sete cenários medidos. Não há suporte para afirmar que esses freezes longos ocorreram durante o intervalo entre primeira e última amostra. Podem pertencer ao startup ou ao trecho anterior à primeira coleta; devem ser preservados como diagnóstico separado, não descartados.

Capturar baseline RTP imediatamente no início da janela steady e usar deltas de freezeCount, duração de freezes, framesDropped, framesReceived e packetsLost. Publicar startup e steady separadamente. Sob a análise entre primeira e última amostra, as reprovações por freezes não se sustentam; os controles ainda ficam abaixo do alvo de 55 FPS. Não editar retroativamente os resultados brutos.

## P1 — Áudio apresenta concealment elevado, inclusive em cenário PASSED

Calculei `100 × delta(concealedSamples) / delta(totalSamplesReceived)` entre primeira e última amostra:

| Condição | Amostras ocultadas/sintetizadas |
|---|---:|
| Controle 1 / 2 | 35,06% / 36,29% |
| Prévia suspensa 1 / 2 | 35,23% / 34,64% |
| Player mutado | 33,98% |

Segundo a [especificação W3C](https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-concealedsamples), concealedSamples são amostras substituídas por síntese local, por exemplo por perda ou chegada tardia; totalSamplesReceived inclui essas amostras. A razão acima não representa percentual de pacotes perdidos.

É um sinal forte para investigar cadência/timestamps do áudio e prazos de reprodução. Não prova isoladamente defeito em WASAPI, Opus ou sincronização A/V. A perda zero publicada nesta bateria é do vídeo e não exclui problemas na trilha de áudio. O receptor permanece globalmente silenciado, logo não foi verificada a percepção acústica.

Adicionar ao relatório e ao orçamento: packetsLost/packetsDiscarded de áudio, concealmentEvents, jitter efetivo/mínimo/alvo, taxa de amostras ocultadas, correções de relógio e timestamps do emissor. Correlacionar com produção WASAPI, filas e RTP. Verificar áudio em endpoint separado antes de aprovar qualidade A/V.

## P1 — Três falhas de inicialização e recuperação incompleta

Jitter zero, 25 ms e padrão retornaram “Espectador não reproduziu stream nativo dentro de 45s”. Não há coleta que permita comparar essas políticas nesta rodada. O erro acontece no início da transmissão, antes de chegar à aplicação dos alvos do cenário; não é prova de que as três políticas causam timeout.

O executor só chama stopNativeCapture no caminho de sucesso. O finally fecha o navegador dedicado quando existente, mas não garante parada da captura após exceção. O catch registra a falha e segue. Isso permite que a primeira falha deixe estado residual e contamine as seguintes; é um risco demonstrado pelo código, não causa comprovada dos três timeouts.

Implementar teardown idempotente em finally, confirmar idle e peer encerrado, e registrar diagnósticos de sinalização/ICE/DTLS/worker e screenshot no erro. Reexecutar os cenários em sessões limpas para separar falha do produto de falha do harness.

## Avanços e evidência de otimização

- Fonte com estatísticas específicas da janela steady: máximos de desenho 24,1–24,2 ms e sem slots perdidos reportados. Não explica os freezes longos anteriores à primeira amostra.
- Ordem dos três controles foi invertida na segunda repetição. A prévia suspensa ganhou 1,9 FPS na primeira comparação e 3,4 na segunda. Os descartes relativos entre primeira/última amostra ficaram em 10,2–11,0% no controle, contra 5,0–6,8% sem prévia. A hipótese de custo da prévia ficou mais forte, mas duas amostras curtas não bastam para quantificar ganho geral.
- Vídeo puro sustentou 57,1–57,2 FPS, com aproximadamente 4,2–5,0% de frames descartados/recebidos nesse intervalo. Ainda não são 60 FPS estáveis.
- Mute por processo passou a criar navegador dedicado sem --mute-audio. Correção presente no código, não validada nesta máquina por falta da capacidade.
- Gaps passaram a ser normalizados por minuto; o denominador ainda usa duração solicitada, não a duração efetiva medida.
- Salvamento progressivo ocorre antes de o chamador atribuir o cenário retornado ao objeto results. Em interrupção, o arquivo pode ficar um cenário atrasado. Salvar após atribuição; o relatório final desta rodada contém os resultados.

## Próxima prioridade e validação

1. Corrigir baseline dos contadores e teardown após timeout; adicionar regressões específicas para esses dois casos.
2. Investigar o concealment de áudio antes de aprovar A/V ou ajustar jitter novamente.
3. Repetir controle/prévia/vídeo puro em 3–5 blocos de 60 s e sessões verificadas; manter startup e steady separados.
4. Reexecutar jitter em condições recuperadas e adicionar medição óptica/áudio para delay e sincronismo.

Executei `npx vitest run tests/e2e-telemetry.test.js`: 16/16 testes passaram. Eles não comprovam cobertura do bug de baseline no executor. Não há medição glass-to-glass, comparação web ou carga de jogo nesta bateria.
