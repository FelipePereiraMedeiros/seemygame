# Replay: implementação, evidências e limites da validação

Atualizado em 2 de outubro de 2026. Os nomes dos diretórios de artefatos usam UTC.

## Decisão implementada

O replay é opcional e a transmissão local não é gravada automaticamente. O espectador pode gravar uma única transmissão selecionada; receber outra transmissão não abre um segundo gravador. Trocar a fonte ou as preferências reinicia o histórico. O controle fica em **Replay e desempenho**, junto aos controles de clipe.

No web, há perfis original, até 720p/30 FPS e até 480p/15 FPS, com seleção de codec. Os perfis reduzidos usam uma trilha derivada e não aplicam constraints à trilha transmitida. Permaneceram **opcionais**: o padrão preserva resolução/FPS da fonte e a preferência anterior por VP9. Os experimentos com canvas/VP8 não justificaram promovê-los como otimização universal. Suporte de MIME não demonstra aceleração por hardware. MP4 web só é candidato para gravação completa, pois o exportador circular atual trata WebM; H.264 circular depende de suporte a WebM.

No aplicativo, o replay local H.264 reutiliza os pacotes codificados pelo worker. Um destino adicional no fanout entrega H.264/Opus a um pipeline de depayload/parse e a um buffer circular; a exportação remuxa os buffers em MP4. **Não há decoder nem encoder adicional nesse caminho.** A captura web dentro do Tauri continua usando o gravador web. Microfone web também usa esse caminho, porque sua trilha não está no RTP nativo.

O buffer nativo tem limite de 128 MiB de dados codificados e 5–120 segundos; a opção duração zero é limitada a 120 segundos nesse modo. Bitrate alto pode reduzir a história disponível. A exportação começa em um quadro-chave, mantém offsets A/V e monta o arquivo fora do lock da captura. Exportar exige memória temporária adicional ao buffer. HEVC/AV1 não têm replay nativo implementado; a indisponibilidade é apresentada, sem iniciar recodificação silenciosa.

## Bugs encontrados durante os testes

1. O exportador WebM removia o cluster antigo, mas mantinha o relógio absoluto dos clusters recentes. O arquivo podia esperar vários segundos para apresentar a primeira imagem/áudio. Agora o relógio dos clusters retidos é rebased, preservando os offsets relativos dos blocos.
2. Cortar somente no marcador de cluster não garante um começo decodificável. A seleção agora requer um quadro-chave de vídeo e reconhece tanto SimpleBlock quanto BlockGroup sem ReferenceBlock, usados pelo Chromium. O parser percorre os filhos EBML em vez de interpretar marcadores dentro do payload comprimido. Sem um início válido, a exportação informa o problema.
3. A identificação do replay nativo baseada apenas em sessionId também aceitava uma captura browser dentro do Tauri. O roteamento agora exige `session.provider === 'native'`. Um novo evento para o mesmo MediaStream preserva o histórico apenas quando backend/sessionId continuam iguais; trocar sessão nativa ou migrar para o mixer de microfone recria o gravador correto.
4. O histórico podia ser perdido na auditoria quando um teste de clipe falhava depois da amostragem. O runner agora salva as medições antes da exportação e registra a falha no relatório, sem descartar o diagnóstico coletado.

O teste de exportação verifica reprodução real, frames apresentados, áudio não silencioso e codecs/trilhas pelo ffprobe. O histórico pode ser encurtado via `--replay-history` para testar a rotação sem esperar 30 segundos. São preservados bytes brutos para diagnosticar falhas de container. Esses bytes de diagnóstico podem incluir o cabeçalho inicial e um intervalo de mídia descartado; não são o clipe final remuxado.

## O que os resultados locais permitem concluir

**Transmissor e todos os receptores compartilham a mesma máquina.** Logo, gravar no receptor também disputa CPU, GPU e memória com a captura e a codificação do transmissor. A matriz mede o sistema inteiro sob carga compartilhada; não mede isoladamente o custo do replay do host. A fonte histórica é sintética/headless e não representa a captura de um jogo sob saturação.

A matriz exploratória anterior teve duas repetições dos quatro cenários, com três espectadores e perfil original/VP9: [relatório](../output/playwright/replay-matrix-2026-10-01T22-16-55-003Z-source-vp9/report.json). Sem replay, os receptores variaram aproximadamente entre 44 e 55 FPS; uma rodada com replay nos receptores caiu para 8–10 FPS enquanto a fonte continuava perto de 60 FPS. Essa variabilidade impede inferir um percentual confiável de ganho. Também impede atribuir toda queda ao encoder do publicador. Os dados justificam medir separadamente produção, encode, decode e apresentação.

Os candidatos de canvas 720p/30 FPS com VP8 tiveram falhas de exportação e perda de desempenho em algumas rodadas. Os relatórios foram preservados, e o candidato não virou padrão: [primeiro](../output/playwright/replay-matrix-2026-10-01T22-23-36-116Z-balanced-auto/report.json), [segundo](../output/playwright/replay-matrix-2026-10-01T22-28-27-563Z-balanced-auto/report.json). As falhas do container levaram à correção acima; não provam que VP8 é intrinsecamente pior.

O par exploratório com binário recompilado, espectador Chrome, preset ultra e 15 segundos por condição apresentou:

| Condição | FPS mediano decodificado | Latência óptica p50 | p99 |
| --- | ---: | ---: | ---: |
| Replay nativo ligado | 54,92 | 42 ms | 54 ms |
| Replay nativo desligado | 54,85 | 43 ms | 50 ms |

[Ligado](../output/playwright/2026-10-02T03-23-10-592Z-cdd480/report.json), [desligado](../output/playwright/2026-10-02T03-24-25-635Z-1c2fea/report.json). O replay do espectador ficou desligado em ambas as condições, e não houve stutters classificados no steady. Isso demonstra funcionamento naquele cenário, **não equivalência estatística, overhead zero ou comportamento sob jogo saturando a GPU**. O cenário Tauri foi sem áudio; H.264 com Opus foi validado separadamente por teste real de RTP/mux e reprodução no Chrome.

## Validações

- Suíte JS completa: **88 arquivos / 875 testes aprovados**, incluindo política de seleção, eventos dos controles da UI e persistência, erro do gravador, roteamento e troca de backend browser/nativo no mesmo stream, lifecycle nativo, parsing/rebase de WebM e isolamento de trilhas dos perfis. [Log](../output/playwright/replay-unit-final.log).
- Módulos, HTML, CSS, smoke de imports e build dist aprovados.
- Exportação circular web, com replay no host e no receptor, histórico de 8 s: reprodução de vídeo/áudio e container aprovados. [Relatório](../output/playwright/historical-720p-tree-benchmark-2026-10-02T00-11-10-410Z/observed-720p.json).
- Rust: **4 testes aprovados**, incluindo limites de bytes/tempo, restart e exportações repetidas de RTP real H.264/Opus. [Log](../output/playwright/replay-rust-final.log). O fixture gerou MP4 com vídeo e áudio começando em zero e cerca de 5 s.
- Reprodução do MP4 H.264/Opus no Chrome após seek: **60 frames decodificados e áudio não silencioso**. [Resultado](../output/playwright/replay-file-2026-10-02T03-18-12-095Z.json).
- Matriz funcional final: **4/4 cenários aprovados**, um espectador, histórico de 8 s, perfil original/VP9. [Relatório](../output/playwright/replay-matrix-2026-10-02T03-12-28-412Z-source-vp9/report.json). Os FPS foram 48,24 / 45,58 / 27,50 / 49,41 em none/host/viewers/both. Não há relação monotônica que permita atribuir um ganho confiável a essas condições; houve uma única repetição sob carga compartilhada.
- Perfil leve: clipes com áudio/vídeo aprovados após rotação, mantendo a transmissão em 1280×720. [Relatório](../output/playwright/historical-720p-tree-benchmark-2026-10-02T03-18-27-095Z/observed-720p.json).
- Perfil 720p/30 FPS com VP8: exportação circular de vídeo/áudio aprovada após corrigir o parser; o track transmitido permaneceu em 720p/60 FPS. [Relatório](../output/playwright/historical-720p-tree-benchmark-2026-10-02T03-20-53-129Z/observed-720p.json). Passar na reprodução não torna esse perfil o vencedor de desempenho.
- Tauri recompilado + espectador Chrome, replay local ligado e replay do espectador desligado: início, transmissão, exportação MP4 e parada aprovados. [Relatório](../output/playwright/2026-10-02T03-23-10-592Z-cdd480/report.json), [MP4](../output/playwright/2026-10-02T03-23-10-592Z-cdd480/native-replay.mp4). Foram observados 54,92 FPS, p50 óptico 42 ms e p99 54 ms, sem stutters classificados no steady. É uma execução de 15 s em build debug, com fonte sintética e sem áudio.
- Após a correção final da troca de backend no mesmo stream, o aplicativo foi recompilado e revalidado: frontend incorporado igual ao checkout, replay nativo sem MediaRecorder, transmissão ao Chrome, exportação MP4 e parada aprovados. [Revalidação final](../output/playwright/2026-10-02T03-34-15-226Z-1cbe59/report.json). Foram observados 54,89 FPS, p50 óptico 46 ms e p99 62 ms. **Houve uma pausa de apresentação de 840 ms no segundo 9**, com FPS decodificado de aproximadamente 55 naquele intervalo. O classificador sugeriu COMPOSITOR_PRESENTATION com confiança média; isso é uma hipótese, não identificação causal. O teste passou em funcionamento, mas não demonstra ausência de stutters nem permite atribuir essa pausa ao replay.

O MP4 do aplicativo contém H.264 codificado em 1280×720, start_time zero e cerca de 16,9 s. O ffprobe também mostrou SAR 641:712 (pixels não quadrados), preservando a proporção da janela capturada; o elemento video reportou dimensão de apresentação 1280×800. Resolução codificada e dimensão de apresentação não são intercambiáveis em comparações de qualidade. O fixture de áudio separado, 320×180 com pixels quadrados, passou também em reprodução e seek no Chrome.

## Próximo experimento necessário: máquinas separadas

1. Transmissor dedicado A; receptor dedicado B. Começar com um espectador, depois acrescentar outros computadores. Registrar hardware, builds, navegador, resolução efetiva, codec, bitrate, áudio e rota direta/TURN.
2. Repetir sem replay, só transmissor, só receptor e ambos. Testar original e reduzido como variantes, sem alterar ao mesmo tempo bitrate/resolução da transmissão. Alternar/randomizar a ordem e repetir pelo menos cinco vezes por condição, com aquecimento e 60–120 s de steady state.
3. Coletar separadamente CPU dos processos, GPU 3D/copy/video encode/decode, memória, FPS do jogo e da fonte, encode/decode, bitrate, RTT, perdas, NACK/PLI, jitter buffer, frames descartados e pausas de apresentação. Exportar clipes também durante a coleta, para medir o pico da ação de salvar; a matriz atual salva após a medição steady.
4. Avaliar carga ociosa, jogo com FPS limitado e jogo sem limite. Comparar builds release e mesma qualidade efetivamente recebida. O teste histórico de canvas não substitui esse experimento.
5. Para latência óptica entre computadores, sincronizar/verificar os relógios ou usar uma medição externa comum. `Date.now()` de computadores diferentes introduz offset; um RTT não resolve esse offset automaticamente. Reportar erro estimado de sincronização e não interpretar diferenças menores que ele.
6. Comparar distribuições e variação entre rodadas, incluindo p95/p99 de pausas e latência, em vez de escolher o vencedor pela mediana de uma única execução. Reportar diferenças de qualidade visual e duração/áudio dos clipes.

O ganho arquitetural verificável do replay nativo é eliminar a recodificação adicional para gravar o próprio stream. A magnitude do benefício de CPU/GPU e a estabilidade em jogo continuam hipóteses a medir nesse experimento.

## Reprodução

Use um ffprobe funcional no PATH; se houver múltiplas instalações, defina `SEEMYGAME_FFPROBE` com seu caminho absoluto.

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline replay::tests -- --test-threads=1
node tools/e2e/replay-matrix.mjs --repeats 1 --profile source --codec vp9 --viewers 1 --history 8
node tests/e2e-720p-tree-benchmark.mjs --delivery-only --viewers 1 --replay-case both --replay-profile light --replay-codec vp9 --replay-history 8 --warmup-seconds 8 --sample-seconds 12 --clip-check
npm run build:dist
cargo build --manifest-path src-tauri/Cargo.toml --locked --offline
node tools/e2e/run.mjs --exe src-tauri/target/debug/seemygame.exe --preset ultra --seconds 15 --native-replay
```

Referências: [opções de keyframe no MediaStream Recording](https://www.w3.org/TR/mediastream-recording/), [processamento de pedidos de keyframe no Chromium](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/mediarecorder/key_frame_request_processor.cc). O intervalo pedido ao navegador não substitui verificar os quadros-chave presentes nos bytes produzidos.
