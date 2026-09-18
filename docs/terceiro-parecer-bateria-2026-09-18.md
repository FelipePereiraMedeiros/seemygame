# Terceiro parecer — fonte local e áudio habilitado

Revisão de artefatos existentes, sem novo benchmark ou alteração de produção. Rodadas: YouTube `2026-09-18T14-30-36-384Z` e fonte local `2026-09-18T15-20-51-888Z`. Código atual: commit `648d586`, incluindo mudanças de Opus e política de jitter dos commits anteriores.

## Parecer

A validação de áudio e o isolamento entre sessões avançaram, mas a fonte local chamada determinística 60 FPS está efetivamente produzindo ~165 FPS. Os resultados demonstram instabilidade nas condições executadas; não validam um cenário controlado 1080p60 nem permitem atribuir a piora a uma única mudança de produção.

## Resultados da fonte local

| Cenário | FPS médio recebido | FPS p10 | Maior gap de callback | Gaps >100 ms |
|---|---:|---:|---:|---:|
| A/V, saída habilitada, prévia ligada | 37,9 | 8,8 | 1.801 ms | 15 |
| A/V, prévia suspensa | 34,4 | 0 | 2.218 ms | 20 |
| Áudio capturado, saída mutada | 29,4 | 1,0 | 1.799 ms | 26 |
| Vídeo puro | 37,2 | 4,0 | 2.118 ms | 20 |
| Jitter solicitado 0 ms | 36,3 | 3,9 | 1.606 ms | 20 |
| Jitter solicitado 25 ms | 23,6 | 0 | 1.886 ms | 12 |
| Jitter padrão | 32,9 | 0 | 1.882 ms | 15 |

As fases duram aproximadamente 25 s, e as variantes de jitter, 20 s. Não há repetições por cenário. Todos registram zero perda de vídeo. Gaps de RVFC são sintomas no callback de apresentação, não prova isolada da etapa causal. Contagens de gaps não devem ser comparadas sem considerar duração e tamanho das pausas: uma pausa longa pode ser um único evento.

## Achados prioritários

### P1 — A fonte 60 FPS não está limitada a 60 FPS

Em `fixtures/deterministic-60fps.html:71`, cada `requestAnimationFrame` incrementa o contador e redesenha, sem limitador temporal. O próprio relatório registra FPS instantâneo entre ~159 e 167. A confirmação independente por `(frameCount final - inicial) / duração` dá 164,8–165,0 FPS em todos os cenários.

Exemplo do controle: 9.739 − 5.542 = 4.197 frames em 25,443 s ≈ 165 FPS. Isso introduz carga de desenho/agendamento diferente da especificada. Não prova que essa seja a única causa dos engasgos, mas invalida a premissa de fonte 60 FPS.

Corrigir com agenda temporal monotônica de 60 Hz, sem rajadas para compensar atrasos, FPS medido em janela e invariantes de cadência. Separar frames planejados, desenhados e observados na captura.

### P1 — Resolução, relógio e repetibilidade não correspondem ao rótulo

O canvas é 1280×720, apesar do texto “1080p60”; o receptor recebe 1920×1080. É uma fonte 720p com saída 1080p, não conteúdo nativo Full HD.

`getSourceSceneState()` calcula `currentTime = frameCount / 60`. Com 165 FPS, o relógio fictício avança ~70 s durante uma coleta real de 25 s. Ele não serve para medir atraso ou sincronismo A/V. Usar timestamp monotônico real.

`prepareSourceScene()` não reinicia contador, fase da animação ou áudio. O movimento depende de `now` global e a cor depende do contador. Cada cenário mede outra fase, mesmo sendo uma página local. É necessário reset explícito, alinhado ao início efetivo da coleta.

### P1 — Os critérios ainda aceitam condições inválidas para a hipótese

A nova bateria rejeita algumas intervenções não confirmadas e exige cobertura de amostras, o que é positivo. Entretanto, não valida FPS/resolução esperados da fonte; campos como `paused:false`, `readyState:4` e `hasError:false` são valores fixos da adaptação da fonte canvas. Sua presença não comprova saúde nem cadência do produtor.

`COMPLETED` representa término com as invariantes implementadas satisfeitas, não aprovação de desempenho. É preciso registrar separadamente execução, validade experimental e orçamento de qualidade.

### P2 — Áudio habilitado agora tem evidência, mas fidelidade e sincronismo não foram medidos

O controle registra `muted:false`, `volume:1`, track live, níveis de áudio não nulos e mais de 1,17 milhão de amostras recebidas progredindo. Isso atende substancialmente a pendência do volume zerado. Ainda não verifica dispositivo físico de saída, distorção, cortes ou alinhamento A/V.

Áudio de sistema e espectador estão na mesma máquina. Verificar se a saída do espectador compartilha o endpoint capturado e pode ser recapturada; o relatório não registra roteamento de dispositivos. Preferir receptor separado ou rotas de áudio independentes para esse controle.

### P2 — Não há evidência de que áudio ou preview sejam a causa única

Vídeo puro e A/V têm resultados ruins semelhantes. Mutar a saída e suspender a prévia não melhoraram esta execução. Isso enfraquece a explicação exclusiva de que os engasgos seriam produzidos pelo áudio, mas não elimina contribuição de sincronismo A/V, decode ou filas.

Suspender `srcObject` não demonstra encerramento do decoder do peer. Medir stats do preview antes/depois e confirmar a condição durante toda a fase. A média de decode alta continua sendo pista de espera/processamento, sem permitir decomposição da latência ponta a ponta.

### P2 — Mudanças de produção não foram isoladas

Foram alterados `audio-type=restricted-lowdelay`, `perfect-timestamp=false`, `hard-resync=true` e os alvos ultra-low do receptor. Nenhum resultado estabelece qual alteração ajudou ou prejudicou. Não concluir que jitter zero é universalmente melhor com base nesta tabela; 0, 25 e padrão falham no objetivo de estabilidade e não têm latência visual medida.

Guardar baseline e comparar uma alteração por vez, com fonte corrigida, mesmo receptor/binário e ordem alternada. Os hashes de executável/scripts são um avanço; falta incluir o HTML da fonte e demais fontes relevantes para reconstruir o checkout dirty usado.

## Rodada YouTube 14:30 UTC

Também não sustenta aprovação: controle A/V de 17,7 FPS, com fonte terminando em `paused:true`, `readyState:0`, dimensões 0×0. Outros cenários alternam 480p/720p, tempos de reprodução e estados sem vídeo. Apesar disso, estão COMPLETED e sem invariantes não atendidas.

Esse artefato deve ser classificado como inconclusivo para comparação causal. O executor atual já foi substituído pela bateria local; não atribuir retrospectivamente seus novos checks ao código que gerou o relatório antigo.

## Ordem recomendada

1. Corrigir fixture: FPS real, tamanho nativo, relógio e reset de cena/áudio; incluir essas invariantes antes de iniciar coleta.
2. Repetir o controle A/V com fonte e espectador separados quando possível; registrar endpoints de áudio.
3. Medir captura → encode → RTP → decode → apresentação, incluindo filas, drops, codec/decoder e carga por engine de GPU. Não usar perda zero para excluir gargalos locais.
4. Comparar mudanças de Opus e jitter individualmente. Rodar 3–5 repetições de 60 s estáveis por condição, alternando ordem.
5. Reintroduzir medição visual e A/V em bateria específica, controlando overhead. Só depois afirmar redução de delay e comparar com web sob carga de jogo.

Conclusão: melhor capacidade de observar o problema, mas sem demonstração de correção. A fonte local precisa ser saneada antes de mais otimizações de produção orientadas por estes resultados.
