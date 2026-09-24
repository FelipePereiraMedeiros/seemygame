# Plano: transmissão web estável sob carga de jogos

Data: 24/09/2026. Escopo: diagnóstico, testes e melhorias do SeeMyGame web, usando Meet como referência observável e Tauri como controle de regressão.

## 1. Objetivo e evidências

Objetivo: manter transmissão fluida e atraso controlado durante jogos exigentes, sem obrigar o usuário a limitar o FPS do jogo. Permitir redução transparente de qualidade quando necessária, respeitando as preferências do usuário.

Observações fornecidas pelo usuário:

- O Tauri mantém boa transmissão/FPS mesmo com jogos abertos.
- O web funciona bem em carga leve, mas degrada muito em jogos exigentes.
- Limitar o FPS do jogo melhora bastante o web.
- O Meet aparenta manter fluidez sem limitar o FPS do jogo.

Isso sustenta a hipótese de disputa por recursos, mas não identifica se o gargalo é captura, composição, CPU, encoder, memória ou recepção. A fluidez aparente do Meet ainda precisa ser associada a resolução, FPS e atraso efetivos. Não assumir prioridade especial de CPU/GPU, codec específico, zero-copy ou estratégia interna do Meet sem evidência.

O controlador atual em `js/abr.js` reage a sobrecarga de encode reduzindo bitrate. O sender já solicita `motion` e `maintain-framerate`. O próximo passo é medir se a adaptação reduz suficientemente o trabalho, não simplesmente adicionar essas opções novamente.

## 2. Regras para progredir sem repetir testes inconclusivos

1. Cada experimento precisa de hipótese, variável alterada, controle, métricas e decisão esperada.
2. Não misturar resultados de commits, binários ou parâmetros diferentes. Registrar hash do código, estado local, browser, driver, hardware, codec e configuração efetiva.
3. Não mudar código durante uma bateria. Correção do medidor invalida comparações históricas que dependam dela.
4. Usar um transmissor e um espectador em máquinas distintas no diagnóstico principal. Teste na mesma máquina fica como cenário adicional, pois o receptor também disputa os recursos do jogo.
5. Rodar Meet, web e Tauri separadamente, alternando a ordem para reduzir viés térmico. Nunca simultaneamente no comparativo principal.
6. Limitar FPS do jogo é intervenção diagnóstica e possível recomendação opcional; não é critério de conclusão do trabalho.
7. Não perseguir uma latência mínima prometida. Avaliar distribuição, continuidade e qualidade efetiva conjuntamente.

## 3. Fase A — preparar uma referência confiável

### A1. Cenário repetível

- Escolher o jogo/cena que reproduz a falha, preferencialmente benchmark interno ou replay determinístico.
- Fixar resolução, preset do jogo, modo de janela, monitor/Hz, áudio, alimentação, plano de energia e aceleração do navegador.
- Usar a mesma modalidade de compartilhamento: janela com janela ou tela com tela. Compartilhamento de guia não serve como equivalente de captura de jogo.
- Começar com um espectador, câmera/microfone/efeitos desligados e sem replay local. Acrescentar áudio e outras funções em fases posteriores.
- Registrar aquecimento e clocks quando disponíveis. Não coletar informação sensível desnecessária nos dumps; usar sala e conteúdo de teste.

### A2. Capturar o comportamento efetivo do Meet

Abrir `chrome://webrtc-internals` antes da chamada e exportar estatísticas ao final. Registrar manualmente horário das fases e configurações da chamada. Preparar leitor que identifique o fluxo de compartilhamento correto, sem confundir câmera, áudio, retransmissões e eventuais camadas de vídeo. Campos ausentes devem ser `null`, nunca zero.

Extrair, quando disponíveis: codec, implementação do encoder, resolução/FPS enviados e recebidos, bitrate, tempo de encode, limitações de qualidade, atrasos de envio, perdas, RTT, decode, jitter buffer e freezes. No receptor do Meet, obter também evidência de apresentação; não tratar frames decodificados como frames necessariamente exibidos.

Usar Playwright no nosso E2E. Para Meet, prever autenticação, permissões e seleção de compartilhamento manuais; automatizar coleta/importação onde permitido e tecnicamente disponível. O plano não depende de acessar APIs privadas do Meet.

### A3. Calibrar instrumentação

- Reutilizar marcador óptico e separação warmup/steady existentes, validando timestamps e relógios.
- Em máquinas diferentes, não subtrair timestamps de relógios sem medir offset e incerteza. Para diferenças pequenas, usar referência óptica externa com fonte e receptor visíveis na mesma gravação, ou método de sincronização validado. Sem isso, classificar latência absoluta como indisponível.
- Medir impacto da instrumentação: desligada, apenas estatísticas e estatísticas + amostragem óptica. Começar em 8 Hz, sem assumir custo desprezível.
- Medir cadência de apresentação continuamente com callback leve. A amostragem óptica esparsa não mede sozinha todas as pausas.
- O marcador não deve transformar o teste de jogo em captura de uma janela sintética leve. Se não for possível inseri-lo sem alterar o cenário, separar ensaio óptico e ensaio de jogo e explicitar a limitação.

**Entrega A:** manifesto por execução, importador do dump Meet e relatório com campos comparáveis/disponibilidade. Só avançar para comparação causal após validar o instrumento.

## 4. Fase B — comparação curta que localize a diferença

Triagem: 15 s de aquecimento + 60 s úteis, três repetições por condição. Confirmação das diferenças relevantes: cinco repetições com 120 s úteis, ordem alternada. Calcular resultados por execução e variabilidade entre execuções; milhares de frames de uma única chamada não são milhares de experimentos independentes.

| Experimento | Condições | Decisão |
|---|---|---|
| B1 Referência | Meet, web atual e Tauri; jogo sem limite | Quantificar diferença real de fluidez, qualidade e atraso |
| B2 Carga equivalente | Web com resolução/FPS efetivos observados no Meet | Separar orçamento de qualidade de eficiência do pipeline |
| B3 Trabalho adicional | Web mínimo; depois replay e previews reativados individualmente | Identificar custo de cada função |
| B4 Encoder | Codecs disponíveis, mantendo saída equivalente | Verificar implementação real e custo; não presumir hardware pelo nome do codec |
| B5 Captura | Janela versus tela, em rodadas separadas e equivalentes | Identificar dependência do backend/caminho de captura |
| B6 Disputa | Jogo sem limite versus limite conhecido por melhorar a transmissão | Medir qual etapa melhora quando há folga |

Não executar todas as combinações possíveis. Começar B1–B3; selecionar B4/B5 conforme os dados. Tauri é controle: não alterar seu pipeline para melhorar o web.

## 5. Métricas e interpretação

| Camada | Medidas | O que permite concluir |
|---|---|---|
| Fonte/captura | Cadência observável antes do encoder, gaps, dimensões, configuração da track | Se os frames já chegam irregularmente; registrar proxy e custo quando não houver medida direta |
| Encode | ΔtotalEncodeTime/ΔframesEncoded, FPS, encoder/codec, qualityLimitationReason e suas durações | Se encode/adaptação participa da queda; `cpu` não é diagnóstico específico de GPU |
| Envio/rede | Bitrate, ΔtotalPacketSendDelay/ΔpacketsSent, RTT, perdas, NACK/PLI e candidate pair | Se há fila/congestionamento; delay médio de pacotes não é latência de frame |
| Recepção | Decode por frame, jitter buffer por item emitido, descartes, freezes | Se a recepção é o primeiro ponto de degradação |
| Apresentação | FPS útil, gaps p50/p95/p99, maior pausa, tempo congelado | Fluidez realmente percebida |
| Imagem/latência | Resolução efetiva, frames únicos, latência p50/p90/p99 com incerteza | Se a fluidez foi comprada com redução de qualidade ou aumento de atraso |
| Sistema/jogo | CPU por processo, GPU 3D/Copy/Video Encode/Decode, memória, frametimes do jogo | Correlação com contenção e impacto causado pelo streaming |

Calcular contadores cumulativos por delta, detectando resets, troca de SSRC e renegociação. `maxFramerate` é teto, não FPS entregue. Não somar médias de componentes para explicar uma diferença de medianas ponta a ponta.

Se necessário, usar uma captura curta de ETW/WPR/GPUView depois de localizar a janela problemática. Não começar com tracing pesado em toda bateria. Não usar hooks/injeção no jogo para essa etapa.

Árvore de decisão:

- Captura já irregular → investigar modalidade de captura, resolução/FPS na origem, composição e disputa GPU/CPU.
- Captura regular, encode irregular → codec/implementação, resolução, FPS e encoders adicionais.
- Encode regular, envio atrasado → congestionamento, pacing e upload por espectador.
- Recepção regular, apresentação irregular → renderização, thread principal, previews e carga do receptor.
- Meet usa menos pixels/FPS → testar essa carga no web antes de concluir superioridade arquitetural.
- Meet mantém qualidade equivalente e melhor resultado → aprofundar encoder/captura e trabalho adicional; descartar explicações baseadas apenas em resolução.

## 6. Fase C — implementar adaptação orientada ao gargalo

### C1. Separar política e aplicação

Evoluir `js/abr.js` para produzir uma decisão estruturada: motivo, bitrate, escala de resolução, FPS e nível de pressão. Separar limite/preferência do usuário dos parâmetros temporários aplicados. Não sobrescrever permanentemente a preferência ao degradar qualidade.

Em `js/app.js` e `js/webrtc.js`, serializar alterações por sender, consolidar decisões pendentes e registrar sucesso/erro/valores efetivos. Ajustes automáticos não devem publicar transmissão inexistente, reiniciar captura nativa ou disparar renegociação por amostra. Revalidar o código atual antes de reutilizar caminhos apontados na revisão anterior, pois houve correções posteriores.

### C2. Respostas distintas

- **Rede:** reduzir teto de bitrate; avaliar resolução se a qualidade visual se tornar inadequada.
- **Processamento:** reduzir pixels por frame; se insuficiente, reduzir FPS para uma cadência sustentável. Exemplo experimental: 1080p60 → 720p60 → 720p30 → 540p30. A sequência final depende dos resultados e da preferência por fluidez/nitidez.
- **Captura saturada:** testar restrições suportadas na track. Redimensionar somente no encoder pode não aliviar a captura original. Confirmar `getSettings()` e a cadência efetiva; tratar recusas sem interromper a sessão.
- **Receptor específico:** adaptar esse envio quando possível, sem degradar todos por causa de um espectador. Alterar a fonte compartilhada tem efeito global e exige política própria.

### C3. Estabilidade do controlador

Começar com amostras de 1–2 s, reação após pressão persistente em duas amostras e recuperação após 10–15 s estáveis. Usar cooldown após cada mudança, histerese e recuperação de um nível por vez. Esses valores são parâmetros experimentais, não garantias.

Não classificar sobrecarga apenas por encode >20 ms: considerar FPS alvo, tendência, gaps e sinal do navegador. Não interpretar encode médio como ocupação exata do pipeline, pois há paralelismo. Evitar controlador próprio oscilando contra a adaptação interna do WebRTC.

### C4. Reduzir custo acessório e escolher encoder

- Medir replay ligado/desligado e permitir modo de transmissão com menor custo, informando claramente quando replay estiver indisponível.
- Reduzir previews duplicados e trabalho visual desnecessário sem remover métricas essenciais.
- Escolher preferência de codec com base nos resultados do dispositivo. Negociar codec no início; não trocar repetidamente em execução como reação primária.
- Não prometer seleção forçada de encoder CPU/GPU via WebRTC: medir o que o navegador realmente escolheu. Desativar aceleração global fica restrito a diagnóstico separado.

**Entrega C:** controlador atrás de flag, telemetria das decisões, configuração manual preservada e rollback independente do Tauri.

## 7. Testes de implementação

### Unitários

- Rede ruim reduz bitrate; pressão de processamento produz mudança de resolução/FPS conforme política.
- Métricas ausentes, NaN, resets e troca de SSRC não geram decisões falsas.
- Histerese/cooldown impedem oscilação; recuperação respeita o limite do usuário.
- Decisões por espectador não vazam para outros peers; decisão global de captura é explícita.
- Mudanças rápidas consolidam o último estado; falha de `setParameters`/`applyConstraints` preserva funcionamento e permite nova tentativa.

### Integração em navegador

- Verificar aplicação real de escala/FPS e continuidade de áudio/vídeo sem reiniciar a sessão.
- Aplicar pressão e removê-la; verificar degradação e recuperação, inclusive com aba em segundo plano e áudio ativo.
- Entrar/sair um segundo espectador durante adaptação.
- Confirmar que usuário ocioso não passa a ser anunciado como transmissor.
- Validar replay/previews ligados e desligados e exportação de clipe com áudio tardio, quando replay participar do cenário.

### E2E de desempenho

Estender `tools/e2e/run.mjs` e `tools/e2e/telemetry.mjs`, preservando o medidor validado, para incluir fases de repouso → carga → recuperação, manifesto, eventos de adaptação e importação dos resultados Meet. Flags novas devem ser documentadas como implementadas somente após existirem.

Testar primeiro 1 espectador remoto; depois 2/3 espectadores, áudio, replay e rede degradada. Rodadas de carga sintética ajudam regressão automatizada, mas não substituem o jogo que reproduz a falha.

## 8. Critérios de aceite e encerramento

Limiares iniciais propostos, a confirmar após a referência medida:

- Com jogo sem limite, em qualidade equivalente à referência Meet, manter pelo menos 95% do FPS alvo efetivamente escolhido durante regime estável.
- Gaps de apresentação p99 ≤2,5 intervalos de frame; nenhum congelamento >250 ms em 120 s úteis após estabilização. Reportar também pausas de 100–250 ms e percentual de tempo congelado para evitar esconder problemas abaixo do corte.
- Diante de pressão sustentada, estabilizar num perfil viável em até 5 s; não alternar perfis repetidamente em carga constante.
- Fluidez não pode ser obtida por crescimento contínuo do atraso. Comparar latência p50/p99 com baseline e incerteza; proposta inicial: aumento ≤1 frame na mediana e ≤2 frames no p99, quando a medição permitir essa precisão.
- Sem regressão mensurável relevante no Tauri e sem piorar em mais de 5% o frametime p95 do jogo contra o web anterior na mesma carga; registrar variabilidade antes de concluir.
- Nenhuma regressão funcional de áudio, sala, clipping ou reconexão; comparar qualidade visual para impedir que resolução muito baixa seja classificada como vitória.

Se os critérios não forem atingidos, o resultado deve indicar a primeira etapa que degrada, a intervenção que a altera e o limite observado. Não encerrar com “falta prioridade” sem evidência de escalonamento, nem repetir baterias sem mudar hipótese.

## 9. Ordem prática e entregáveis

1. **P0 — Referência:** capturar Meet/web/Tauri no jogo problemático, com manifesto e comparação da qualidade real.
2. **P0 — Isolamento:** igualar carga do Meet e testar web sem replay/previews adicionais. Publicar uma conclusão causal limitada aos dados.
3. **P1 — Correção dirigida:** implementar a menor intervenção que resolva o gargalo identificado; se confirmado, controlador de resolução/FPS além do bitrate.
4. **P1 — Validação:** testes unitários, integração real e cinco repetições sob carga com jogo sem limite.
5. **P2 — Robustez:** múltiplos espectadores, áudio/replay, outras GPUs, codecs e modalidades de captura.

Entregas: manifesto e dados brutos por execução; comparativo por rodada; linha do tempo dos gargalos/decisões; testes de regressão; implementação com flag; relatório final com ganhos, custos, limitações e configuração recomendada. Nenhuma alteração no pipeline de produção é realizada por este planejamento.

## Referências

- [Google Meet: adaptação ao desempenho e aceleração GPU](https://support.google.com/meet/answer/7317473?hl=en).
- [W3C: WebRTC](https://www.w3.org/TR/webrtc/).
- [W3C: dicas de conteúdo das tracks](https://www.w3.org/TR/mst-content-hint/).
- `docs/revisao-completa-codigo-2026-09-24.md`: achados anteriores a revalidar no código atualizado; não presumir que todas as pendências continuam abertas.
