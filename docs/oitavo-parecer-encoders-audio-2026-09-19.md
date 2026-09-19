# Oitavo parecer — correções de áudio, CPU e testes focados

Revisão em 19/09/2026 do código até `be1374d` e dos relatórios de 04:58, 05:00, 05:04 e 12:46 UTC. Não foi executada nova transmissão nesta revisão.

## Conclusão

Há progresso real no pipeline: concealment de áudio caiu de aproximadamente 34% para 0,49–0,58%, acompanhado de queda nos descartes de aproximadamente 340 para 5–6 pacotes por execução. O vídeo já apresentou uma execução de 59,2 FPS sem freezes steady. Porém, a última execução de vídeo puro caiu para 53,2 FPS com descarte elevado, embora sem freezes steady. Não é possível atribuir essa diferença a CPU/GPU porque os relatórios não registram o encoder efetivamente selecionado.

## Mudanças revisadas

- `cc6a7df`: `perfect-timestamp=true`, remoção de `hard-resync=true` e `rtpjitterbuffer latency=20 do-lost=true drop-on-latency=true` antes do depayloader de áudio.
- `bdde95c`: backend H.264 CPU com `d3d11download → x264enc`, ultrafast, zerolatency, bframes=0 e ref=1; opção selecionável por `SEEMYGAME_NATIVE_H264_ENCODER`. GOP dos encoders H.264 e HEVC foi reduzido, passando de aproximadamente dois segundos para um segundo a 60 FPS.
- `be1374d`: diagnóstico dentro do catch anterior ao finally, espera de autorização mútua da sala e filtro de cenários CLI/ambiente. São mudanças na direção correta para testes focados e diagnóstico de timeout.

O hash do executor atual coincide com o registrado nos relatórios citados. O SHA do Git registrado (`d6fe86c...`) difere do histórico atual, portanto usar também hashes de conteúdo ao reconstruir a execução. O binário mudou em relação à bateria problemática anterior: SHA256 iniciado em `14a51609`, em vez de `373f91ca`.

## Resultados

| Rodada UTC | Condição | FPS médio | Freezes steady | Pacotes áudio descartados | Concealment |
|---|---|---:|---:|---:|---:|
| 04:58 | A/V, prévia ativa | 52,3 | 1 (0,29 s) | 6 | 0,58% |
| 05:00 | Vídeo puro | 59,2 | 0 | N/A | N/A |
| 05:04 | A/V, prévia suspensa | 58,5 | 0 | 5 | 0,49% |
| 12:46 | Vídeo puro | 53,2 | 0 | N/A | N/A |

São sessões isoladas de aproximadamente 20 segundos, não uma comparação pareada de encoders. Os receptores continuam globalmente silenciados; não foi validada reprodução audível nem sincronismo A/V físico.

## O que os resultados permitem concluir

**Áudio:** a hipótese de cadência/timestamps recebe forte apoio. O conjunto de alterações está associado a melhora grande e repetida. Não afirmar “eliminou descartes”: ainda existem 5–6. Como as propriedades do Opus e a ponte mudaram juntas, ainda não sabemos a contribuição individual. Falta medir a latência acrescentada pelo novo estágio e testar duração maior; estabilidade não implica redução automática de delay.

**Vídeo:** a comparação mais informativa é entre as duas sessões de vídeo puro. Ambas receberam 1.219 frames na janela steady. A primeira descartou 8 (~0,66%); a última, 141 (~11,57%). Decodificaram 1.203 e 1.078, respectivamente. O decode médio reportado passou de 88,4 para 148,6 ms. Entre primeira/última amostra houve 19 keyframes em ambas e zero novos PLIs. Na última rodada o problema observado é descarte/cadência abaixo da meta, sem a paralisação longa que dominava a bateria anterior. Isso orienta a investigação ao processamento do vídeo recebido, sem provar saturação de hardware ou excluir influência de timestamps do emissor.

A última execução teve freeze de 0,785 s no startup, corretamente separado de steady. `maxPauseMs=0` significa ausência de gaps acima do limiar de 100 ms, não ausência de qualquer irregularidade.

## Pendências concretas

1. **Identidade do encoder é obrigatória no A/B.** `supports_cpu_h264=true` indica disponibilidade, não uso. O executável herda variáveis de ambiente e o relatório omite `SEEMYGAME_NATIVE_H264_ENCODER`, backend resolvido e pipeline executado. Registrar esses campos, bitrate/GOP efetivos e versão dos plugins. Sem isso não há conclusão CPU versus GPU auditável.
2. **Validar CPU de verdade.** O teste Rust adicionado verifica strings do pipeline; não prova negociação D3D11→I420→RAM, inicialização do x264 ou desempenho em 1080p60. Executar smoke do pipeline e E2E com confirmação explícita de backend CPU.
3. **Auditoria de dependências incompleta.** A ponte passou a exigir rtpjitterbuffer, mas não há referência correspondente na lista de validação em `tools/validate-native-media.ps1` ou na detecção de elementos de `media.rs`. Incluir a dependência para falhar cedo em runtime incompleto.
4. **Filtro sem correspondência.** Um filtro digitado incorretamente pode terminar sem cenário medido; rejeitar seleção vazia e registrar cenários solicitados/executados. O cenário de processo não suportado aparece mesmo em relatórios focados em vídeo puro, o que confunde a leitura da seleção.
5. **Diagnóstico temporal ainda incompleto.** As capturas antes do teardown corrigem o erro principal; adicionar timestamp e marcador de origem para distinguir diagnóstico pré-teardown do fallback posterior.

## Próximo experimento recomendado

Preservar a correção de áudio e comparar explicitamente NVENC versus CPU em vídeo puro, com mesmo GOP, resolução, FPS, receptor, fonte e bitrate solicitado, em ordem alternada. Capturar encoder efetivo e bitrate real; os modos atuais de rate control não são necessariamente idênticos. Medir frames recebidos/decodificados/descartados, tempos de CPU/GPU e qualidade visual. Se possível usar receptor separado para reduzir competição local.

Depois testar A/V com e sem prévia no backend escolhido. Não alterar encoder, GOP, buffers e áudio simultaneamente outra vez: agora há um baseline promissor a preservar. As novas rodadas indicam melhora real, mas ainda não validam latência, carga de jogo nem superioridade de um encoder.
