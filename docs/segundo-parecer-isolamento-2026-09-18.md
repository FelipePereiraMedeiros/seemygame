# Segundo parecer — isolamento YouTube, 18/09/2026

Revisão das rodadas `2026-09-18T12-54-28-848Z` e `2026-09-18T13-03-20-324Z`, e das alterações dos commits `42fc518` e `c2deac1`. Não foi executado novo benchmark nem alterado código de produção.

## Conclusão

Houve progresso verificável na qualidade do instrumento e na cadência observada. A última rodada demonstra períodos de 1080p recebido próximos de 60 FPS com uma trilha de áudio presente e saída silenciada. Ainda não comprova estabilidade com som audível, redução de latência ponta a ponta, superioridade de uma política de jitter ou liberação efetiva do decoder da prévia.

## Resultados da rodada 13:03 UTC (10:03 local)

| Cenário declarado | FPS médio | FPS p10 | Decode médio por intervalo | Maior pausa RVFC | Gaps >100 ms |
|---|---:|---:|---:|---:|---:|
| Vídeo puro | 55,2 | 42,2 | 42,2 ms | 1.377 ms | 4 |
| Áudio, saída mutada | 60,0 | 59,2 | 1,1 ms | 0 | 0 |
| Prévia desconectada do elemento | 60,0 | 59,2 | 0,9 ms | 0 | 0 |
| Jitter solicitado 0 ms | 60,0 | 59,4 | 1,0 ms | 0 | 0 |
| Jitter solicitado 25 ms | 59,6 | 58,3 | 4,7 ms | 0 | 0 |
| Jitter padrão | 60,0 | 55,4 | 43,3 ms | 142 ms | 1 |

Zero na coluna de pausas significa ausência de gaps registrados acima do limiar de 100 ms, não ausência absoluta de irregularidade. FPS são de decode, não necessariamente frames distintos apresentados do conteúdo original do YouTube. Tempo de decode não é latência visual ponta a ponta.

As fases principais têm cerca de 30,4 s e 29 amostras válidas; os subtestes de jitter, cerca de 20,3 s e 19 amostras. Todas reportam zero perda de vídeo. Não existe nova medição óptica glass-to-glass nestas rodadas.

## O que foi atendido

- `enableOptical:false`: evita canvas/readback e busca de marcador no YouTube.
- `resetSession()`: zera gaps, máximos, contadores e referência temporal antes de cada fase. Desapareceu o máximo de ~9,2 s repetido entre todos os cenários.
- Duração controlada por relógio, com `elapsedMs` e duração real registrada.
- Identificação de tracks e resolução do elemento remoto em cada amostra.
- Mute aplicado depois de iniciar a captura e confirmado: trilha de áudio presente, `muted:true`, `volume:0` durante a fase 2.
- Ambos os parâmetros de buffer são ajustados e lidos de volta. Na rodada mais recente há receivers de áudio e vídeo identificados nos três cenários.
- Proveniência inclui SHA-256 do executável, data, tamanho, commit, estado dirty e ambiente básico.
- Prévia: o botão agora remove `srcObject`, e o relatório mais recente confirma `hostPreviewSuspended:true`. Na rodada 12:54 essa confirmação era falsa.

## Pendências que mudam a interpretação

### 1. Não há cenário com áudio audível confirmado

Na última rodada, fase 2 tem `muted:true, volume:0`; fases 3, 4A, 4B e 4C têm `muted:false, volume:0` em todas as amostras. O volume zerado atravessou os cenários. Assim, a afirmação “áudio ligado sem engasgos” deve ser limitada à recepção com track de áudio presente e saída silenciada.

Criar baseline A/V com `muted:false`, `volume>0`, track live e energia/contadores de áudio progredindo. Confirmar durante toda a fase, não apenas no final. Não basta existir uma track para comprovar som não silencioso e reprodução correta.

### 2. A prévia melhorou tecnicamente, mas seu ganho não foi isolado

Remover `srcObject` é uma intervenção mais concreta que mudar opacidade ou pausar. Entretanto, não prova por si só que o peer/decoder de recepção deixou de trabalhar. O commit se chama “truly unload GPU decoder”, mas o que os artefatos comprovam é a desconexão do elemento.

Medir o avanço de `framesDecoded` no peer de preview, atividade da GPU e uso por processo. Comparar preview on/off com o mesmo estado de áudio. Aqui, ambas as fases relevantes já entregaram 60 FPS e 0 gaps; diferença de 1,1 para 0,9 ms não sustenta ganho causal importante.

### 3. O teste de jitter continua sequencial

4A, 4B e 4C reutilizam a conexão e seguem o vídeo sem voltar ao mesmo trecho. Há memória adaptativa de buffers e decoders, além de mudança de conteúdo. A estabilidade de 0 e 25 ms é promissora; a piora do default não demonstra que o padrão seja inferior.

Os valores lidos de volta são configurações aceitas/expostas, não prova da residência real do buffer. O jitter observado de vídeo ficou próximo de 10 ms nas três variantes. Rodar sessões independentes, mesmo trecho e ordem alternada.

### 4. COMPLETED ainda não valida as condições do cenário

O status depende somente de pelo menos cinco amostras válidas de FPS. Na rodada 12:54, o teste de prévia terminou COMPLETED com `hostPreviewSuspended:false`; 4A terminou COMPLETED com `effectiveReceivers:[]`.

Esses resultados devem ser inconclusivos para as hipóteses declaradas. Incluir requisitos obrigatórios por cenário, cobertura mínima de amostras, ausência de mudança de track e confirmação das intervenções. Cliques de prévia e espera de parada ainda descartam erros com `catch` vazio.

### 5. Fonte e atribuição ainda têm lacunas

O vídeo volta ao segundo 25 antes de configurar cada captura, mas continua tocando durante configuração/warm-up: não garante o mesmo frame inicial na janela medida. Registrar tempo real do player, FPS original, resolução, estado de buffering e qualidade. Fonte local determinística continua preferível para causalidade.

A seleção tenta casar `trackIdentifier`, mas ainda faz fallback silencioso para o inbound de maior contador. Com voz e transmissão coexistindo, isso pode selecionar áudio de outra origem. Exigir associação inequívoca ou marcar coleta inconclusiva. Guardar PC/SSRC/codec/decoder e stats brutos.

### 6. A instabilidade sem áudio permanece

Vídeo puro teve FPS zero em um intervalo, pausa de 1,377 s e decode p95 de 137 ms. Portanto, áudio não é condição necessária para haver engasgos. Já a fase default manteve média de 60 FPS, mas decode médio de 43,3 ms e p95 de 142,4 ms. Cadência alta não comprova baixa latência.

Comparada à rodada 12:54, o vídeo puro caiu de 59,2 para 55,2 FPS e sua pausa máxima subiu de 109 para 1.377 ms; já a fase com áudio mutado passou de uma pausa de 4.130 ms para zero gaps. Executáveis e condições diferem. Há variação suficiente para exigir repetições antes de concluir regressão ou correção causal.

### 7. Proveniência parcial

As duas rodadas registram o mesmo commit anterior e `gitDirty:true`, com hashes diferentes de executável. Isso distingue binários, mas não reproduz as alterações locais do executor. Guardar hashes dos scripts/fontes e versões exatas do navegador/WebView2, GPU e driver. Ainda não existe comparação web ou carga de jogo nesta bateria.

## Próximos passos prioritários

1. Corrigir restauração e verificação do volume e incluir A/V audível com preview ligado como controle.
2. Fazer falhar/inconcluir cenários cujas intervenções não foram confirmadas.
3. Isolar políticas de jitter em novas sessões e medir o mesmo trecho efetivo.
4. Repetir 3–5 vezes com 60 s estáveis por cenário e ordem alternada.
5. Separar medição leve de fluidez da medição óptica de latência; obter p50/p95/p99 visuais e sincronismo A/V em bateria própria.
6. Investigar os congelamentos do vídeo puro com dados da fonte, captura, encode, decode e apresentação; depois validar sob carga de jogo e com espectador em outro computador.

Parecer: avanço significativo do instrumento e sinais bons de capacidade, com aprovação parcial. O relato original de engasgos com áudio audível ainda não pode ser considerado resolvido.
