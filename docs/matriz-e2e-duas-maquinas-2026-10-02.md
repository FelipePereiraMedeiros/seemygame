# Matriz E2E em duas máquinas — 02/10/2026

Os quatro caminhos funcionaram com transmissor no desktop e receptor no notebook: aplicativo → web, aplicativo → aplicativo, web → web e web → aplicativo. Foram oito execuções válidas, uma por caminho/preset. **Nenhuma homologou o gate de qualidade de 60 FPS.** A matriz demonstra funcionamento e fornece pistas de desempenho; não determina ainda um vencedor sob carga de jogo.

## Resultados

FPS p50/p10 são os frames decodificados por segundo nos intervalos steady. Freezes e perdas são os contadores finais WebRTC de toda a transmissão, incluindo startup; não são contagens exclusivas de steady. Bitrate é a mediana das amostras do diagnóstico exportado, que inclui fases além de steady.

| Transmissor → receptor | Preset | Resolução recebida | FPS p50 / p10 | Freezes | Pacotes perdidos | Bitrate mediano |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Aplicativo → Chrome | 720p | 1280×720 | 54,96 / 53,27 | 4 | 16 | 1,629 Mbps |
| Web → Chrome | 720p | **1152×720** | 54,93 / 53,94 | 0 | 0 | 0,396 Mbps |
| Web → aplicativo | 720p | **1152×720** | 54,88 / 54,03 | 0 | 0 | 0,398 Mbps |
| Aplicativo → aplicativo | 720p | 1280×720 | 54,74 / 46,76 | 8 | 62 | 1,649 Mbps |
| Aplicativo → Chrome | 1080p | 1920×1080 | 54,96 / 54,37 | 1 | 4 | 1,709 Mbps |
| Web → Chrome | 1080p | **1898×1080** | 54,65 / 53,32 | 0 | 3 | 0,411 Mbps |
| Web → aplicativo | 1080p | **1898×1080** | 54,94 / 54,04 | 0 | 0 | 0,422 Mbps |
| Aplicativo → aplicativo | 1080p | 1920×1080 | 54,95 / 54,27 | 0 | 0 | 1,714 Mbps |

As trilhas web anunciaram 1280×720 ou 1920×1080 em `getSettings()`, mas o RTP recebido mostrou dimensões diferentes. O código usa constraints `ideal`/`max`, que não certificam dimensões exatas. É necessário investigar o enquadramento da janela, a proporção preservada e eventual escala do encoder. Não corrigimos o relatório para fingir a resolução solicitada.

O gate também exige apresentação p10 ≥54 FPS, resolução exata, visibilidade, codec e pausas ≤66,7 ms. A apresentação p10 ficou entre 41,03 e 48,01 FPS. Zero freezes WebRTC não significa automaticamente apresentação perfeita a 60 FPS, nem ausência de pequenas irregularidades.

## Condições

- Captura nativa **D3D11/WGC + NVENC H.264**. O harness confirmou uma conexão nativa direta e zero chamadas de mídia de tela do navegador: GStreamer envia ao receptor, sem recodificar o vídeo no WebView2. A ponte de preview continua existindo localmente.
- Captura web real via `getDisplayMedia`, janela sintética com título exclusivo por execução. Sem substituir por `canvas.captureStream`. Ambos os caminhos pediram 60 FPS e presets `ultra`/`balanced`.
- Receptor Chrome ou Tauri/WebView2 visível, na sessão interativa 1 do notebook; executável Tauri isolado, perfil novo por caso. JavaScript embutido dos aplicativos conferido contra o checkout.
- 70 intervalos por caso: 5 warmup, 63 steady e 2 cooldown. Consultas adicionam tempo; aproximadamente 72 segundos de evidência steady por execução.
- H.264, áudio desligado, replay desligado, fonte sintética a 60 FPS. Sem jogo, stress artificial ou perda artificial. Nenhuma compilação/suíte de testes deste trabalho ocorreu durante os benchmarks.
- CPU/GPU coletadas separadamente nos dois computadores. O desktop ainda executa fonte e transmissor, além de aplicações externas.
- HTTP/sinalização atravessam forwarding SSH; mídia estabeleceu seu próprio caminho ICE UDP. Nativo: `prflx→host`; web: `host→host`, vistos do receptor. RTT mediano entre 5 e 8 ms. Esses tipos de candidato não identificam a interface física nem provam uso de cabo/Wi-Fi/VPN.
- Relógios independentes: **latência glass-to-glass desativada**. RTT não substitui essa medição. Sessão interativa e callbacks não certificam apresentação óptica na tela física.
- D3D12 não foi utilizado nesta matriz. Permanece um probe de captura/conversão, não um encoder diferente nem um caminho homologado ponta a ponta.

As primeiras três rodadas válidas de 720p ocorreram aproximadamente três horas antes das cinco restantes. Os relatórios originais foram preservados; a consolidação não transforma os dois lotes em um A/B simultâneo ou aleatorizado.

## Parecer

**O receptor Tauri não é, por si só, a explicação dos stutters.** Aplicativo → aplicativo em 1080p terminou sem perdas/freezes, enquanto 720p teve oito freezes e 62 perdas. Web → aplicativo também terminou sem freezes nas duas resoluções. Uma execução por condição não autoriza concluir que 1080p é melhor que 720p.

Nos casos nativos com engasgos há perdas/NACKs e queda do decode remoto. Em aplicativo → aplicativo 720p ocorreram, por exemplo, incrementos de 24 e 20 pacotes perdidos acompanhados por dois freezes em cada intervalo e quedas para ~24 e ~9 FPS. Isso prioriza a investigação de perdas, rajadas, pacing e recuperação RTP/H.264. Não prova que toda perda seja da rede física: ainda é preciso localizar o primeiro ponto de descarte, incluindo o loopback UDP local.

O notebook não apresentou saturação generalizada: CPU total p95 de 14,8–21,7%, engine GPU mais ocupada p95 de 11,1–16,7%. Médias/p95 não excluem um pico curto ou bloqueio de uma thread. No desktop, CPU p95 variou de 30,1 a 69,8%, e CPU externa p95 de 3,1 a 19,3%; a carga não foi igual entre casos.

**A comparação nativo × web ainda tem confundidores importantes:** o nativo entregou mais pixels e ~4× o bitrate real. Não há medição de fidelidade visual que permita decidir se essa diferença de bitrate é custo excessivo, melhor qualidade ou diferença de conteúdo/enquadramento. O web teve zero freezes nas quatro rodadas, mas isso não prova superioridade em todas as situações.

## Correções do harness e falhas preservadas

1. Suporte a transmissor web no desktop, mantendo a mesma direção da transmissão remota. O `--compare` local anterior invertia os papéis e não representa essa matriz.
2. Receptor Tauri via CDP, perfil e processo novos por caso. Corrigido o reaproveitamento de perfil que restaurava a sala anterior e ocultava o botão de entrada.
3. PATH de GStreamer somente no processo filho do receptor isolado, sem mudar PATH global.
4. Registro de fechamento/crash/desconexão da janela fonte, separando cleanup de eventos durante o teste. Timeline parcial preservada em falhas. O gate funcional não foi relaxado.
5. Casos que chegam a produzir um relatório mas falham funcionalmente permanecem registrados; os seguintes continuam com receptor novo. Falhas de infraestrutura ainda abortam a matriz e disparam cleanup.
6. O helper remoto havia voltado à versão antiga, sem `--runtime`/`--ready-file`: causou timeout antes da transmissão. A versão encontrada foi preservada e os helpers validados sincronizados. Agora o início exige hashes iguais para `viewer-agent.mjs` e `viewer-task.ps1`, antes de criar a tarefa remota.

Uma tentativa anterior recebeu `Capture item was closed` no worker após ~25 segundos. Ela foi invalidada; não foi contada como medição de desempenho nem como incompatibilidade desktop → desktop. O evento está provado pelo log, mas a causa externa do fechamento daquela janela não foi determinada. A nova execução não reproduziu esse fechamento durante a medição.

Após a matriz: **53 testes focados em 4 arquivos passaram**, sintaxe JS/PowerShell e grafo de módulos validados (162 módulos, 419 imports/exports), `git diff --check` sem erro de whitespace. Verificação SSH confirmou hashes dos helpers, zero tarefas das tentativas retomadas e zero listeners temporários 19333/19334 nos dois computadores. Nenhum commit/deploy foi feito.

## Evidências e reprodução

- Consolidação: `output/playwright/matrix-2026-10-02T21-59-55-790Z-4573bc/combined-report.json`.
- Métricas detalhadas: `output/playwright/matrix-2026-10-02T21-59-55-790Z-4573bc/summary.json`.
- Lote inicial: `output/playwright/matrix-2026-10-02T18-38-18-972Z-68719a/report.json`, incluindo a falha de reutilização do receptor.
- Lote retomado: `output/playwright/matrix-2026-10-02T21-59-55-790Z-4573bc/report.json`, cinco casos aprovados funcionalmente.
- A consolidação aponta os relatórios de cada caso e os lotes inválidos anteriores; logs, imagens, diagnóstico de produção, fonte e recursos permanecem nos respectivos diretórios.

```powershell
# Requer SSH configurado, sessão interativa e helpers/executável validados no notebook.
node tools/e2e/distributed-matrix.mjs --seconds 70
# Consolidar um lote sem alterar os relatórios dos casos:
node tools/e2e/matrix-summary.mjs output/playwright/SEU-LOTE/report.json
```

O launcher atual contém caminhos específicos do notebook e do Node portátil preparado nesta sessão; não é ainda um instalador genérico para qualquer máquina.

## Próximos experimentos, por ordem

1. Igualar **resolução efetivamente recebida, enquadramento, codec e condição de conteúdo**, registrando bitrate real e qualidade visual. Repetir pelo menos três vezes com ordem alternada, mesma rota/interface e carga externa controlada.
2. No nativo, medir filas/descartes do worker e loopback, pacing, NACKs recebidos/atendidos, RTX negociado e retransmissões efetivas. Aplicar uma perda pequena e controlada com o mesmo receptor; comparar recuperação, não só bitrate/FPS medianos. A telemetria atual não comprova RTX efetivo.
3. Só então introduzir jogo limitado/ilimitado e carga CPU/GPU reproduzível, preservando CPU por núcleo e engines de captura/encode/decode. Isso testa a promessa de estabilidade nativa sob disputa, que esta matriz não avaliou.
4. Testar D3D12 ponta a ponta mantendo encoder, codec, resolução e receptor iguais. Separar seu efeito das mudanças de transporte.
5. Calibrar relógios ou usar uma referência óptica comum antes de publicar latência absoluta entre máquinas. Depois adicionar áudio e replay como fatores separados.
