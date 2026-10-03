# Captura D3D12, resolução e preferência automática

## Decisão implementada

O padrão do worker passa a ser `auto`. Depois de resolver o encoder, prefere captura e conversão D3D12 para **H.264/NVENC**, quando os plugins `d3d12screencapturesrc`, `d3d12convert` e `d3d12download` estão disponíveis. Media Foundation, CPU, HEVC e AV1 continuam usando D3D11. `SEEMYGAME_NATIVE_CAPTURE_BACKEND=d3d11` ou `d3d12` força o backend e não permite fallback silencioso.

No modo automático, se o processo D3D12 não iniciar ou encerrar, o worker tenta D3D11 uma vez, preservando codec, resolução, bitrate e portas RTP. Uma falha do substituto encerra a sessão com erro; não há ciclo de reinicializações. A preferência solicitada permanece `auto` nas reconfigurações de qualidade/áudio. O estado IPC informa `captureBackend` e `captureFallbackReason`, inclusive na recuperação assíncrona. Isso cobre falhas do processo; não é um watchdog de imagem congelada com processo ainda vivo.

Este caminho usa D3D12 para captura/conversão, interop em GPU para `D3D11Memory` e o encoder **`nvd3d11h264enc` existente**. Não é troca para um encoder D3D12 puro nem garantia de prioridade exclusiva na GPU.

## Evidência comparativa em duas máquinas

Artefato: `output/playwright/matrix-2026-10-02T23-15-54-028Z-c37e6c/report.json`. Desktop transmite; notebook recebe em Chrome, sem áudio/replay. Fonte 60 FPS, resolução conferida durante todo o intervalo estável, teto comum de 4.500 kbps, 70 intervalos por caso (63 estáveis). Uma execução por condição; sem randomização ou repetição suficiente para homologação.

| Captura / codec real | Resolução recebida | FPS decodificado p50 / p10 | Intervalos estáveis com stutter |
| --- | --- | --- | --- |
| Web / VP8 | 1280×720 | 55,00 / 53,33 | 0 |
| D3D11 / H.264 NVENC | 1280×720 | 54,85 / 53,96 | 2 |
| D3D12 / H.264 NVENC | 1280×720 | 60,03 / 59,36 | 1 |
| Web / VP8 | 1920×1080 | 54,94 / 53,63 | 0 |
| D3D11 / H.264 NVENC | 1920×1080 | 54,92 / 54,18 | 4 |
| D3D12 / H.264 NVENC | 1920×1080 | 59,93 / 57,86 | 5 |

O ganho de cadência D3D12 sobre D3D11 é consistente nesta GPU e também aparece nos frames RTP produzidos antes da rede. **Os stutters não foram resolvidos**: todos os casos falharam o critério estrito de qualidade de 60 FPS. O comparativo web tinha codec diferente; não permite concluir superioridade geral do nativo. RTT não mede glass-to-glass; a medição óptica permanece desativada entre relógios independentes.

## Resolução web e negociação do codec

`output/playwright/capture-geometry-2026-10-02T22-57-03-291Z/report.json` isolou o problema antes do WebRTC: a janela sintética com viewport emulado gerava captura bruta 1152×720 ou 1898×1080, apesar de canvas 1280×720 ou 1920×1080. A calibração da janela física, em circuito fechado com `getDisplayMedia`, produziu as dimensões exatas. A correção é do fixture E2E; não modifica a política de proporção de janelas reais do produto.

Também havia uma corrida: `peer.call()` iniciava a primeira oferta antes de `setCodecPreferences()`. O seletor H.264 podia negociar VP8. Os três caminhos de envio agora passam `sdpTransform` na criação da chamada, priorizando H.264 e seu RTX, preservando atributos e codecs de fallback. `--matched-codec` rejeita um benchmark cujo codec negociado diverge do solicitado.

Nova prova web H.264: `output/playwright/matrix-2026-10-03T02-39-16-175Z-43cff6/report.json`. Ambas as resoluções passaram os critérios funcionais e de codec, usando Media Foundation NVIDIA H.264. FPS p50: 54,52 (720p) e 53,75 (1080p). Entretanto, CPU host p95 chegou a 92,38% e 78,66%, com carga externa substancialmente maior que na matriz anterior. **Não combinar essas execuções como um A/B controlado**, nem atribuir suas diferenças exclusivamente ao codec.

## Pendências e próximos experimentos

1. Repetir condições com mesmo codec/resolução/bitrate, ordem alternada, carga registrada e jogos reais; incluir áudio e replay separadamente.
2. Rastrear NACK/PLI, recuperação de perdas e pedido de keyframe até o encoder externo. Ausência de ligação explícita no código é hipótese, não prova de causa. Investigar as pausas com dados de RTP e apresentação alinhados.
3. O classificador E2E passa a distinguir feedback RTP atual e pausa sem causa demonstrada (`UNRESOLVED_PRESENTATION_STALL`), evitando atribuir todo engasgo ao compositor. Relatórios históricos mantêm suas classificações originais.
4. Avaliar o encoder `d3d12h264enc` em um experimento separado. O plugin local 1.28.7/RTX 3070 conseguiu codificar e decodificar 120 frames sintéticos até EOS (`output/d3d12-encoder-probe-2026-10-02/pipeline.txt`); isso comprova funcionalidade, não latência, estabilidade sob jogos ou superioridade sobre NVENC atual.

Referências: [GStreamer d3d12download](https://gstreamer.freedesktop.org/documentation/d3d12/d3d12download.html), [GStreamer d3d12h264enc](https://gstreamer.freedesktop.org/documentation/d3d12/d3d12h264enc.html), [W3C Screen Capture](https://www.w3.org/TR/screen-capture/).

## Validação da preferência automática

- Suíte frontend: **99 arquivos / 994 testes passaram**. Rust `media::tests`: **20 passaram / 2 benchmarks ignorados**, incluindo seleção por capacidades e retorno único ao D3D11, com preservação da preferência e das portas. Release compilado e frontend embutido conferido pelo E2E.
- `output/playwright/2026-10-03T03-09-42-356Z-4b2e5f/report.json`: transmissor em `auto`, encoder também em `auto`, receptor no notebook. Escolheu **D3D12 / NVENC**, entregou **1920×1080 H.264**, p50 **60,08 FPS**, p10 **59,16 FPS**, com 18 amostras estáveis e nenhum intervalo com stutter. Envio direto: uma conexão nativa e zero chamadas de mídia de tela no navegador.
- `output/playwright/2026-10-03T03-14-30-851Z-be0ae4/report.json`: processo D3D12 do E2E encerrado intencionalmente. Fallback **D3D11** confirmado, com mesma sessão, mesmas portas e mesmo codec; novos frames recebidos após a troca. Recuperação observada pelo teste em **1.522 ms** (inclui detectar o erro e observar pelo menos sete novos frames; não é latência glass-to-glass). Depois da recuperação, 1280×720 H.264, p50 54,95 FPS / p10 54,05 FPS. Teste sem áudio/replay. A rodada anterior `2026-10-03T03-12-26-345Z-b7fdfa` é exploratória: seu contador de frames anterior à injeção podia aceitar progresso ocorrido antes da troca; usar a rodada posterior como prova da recuperação.
- Rodadas curtas são provas funcionais: o próprio relatório registra `qualification.status = insufficient-evidence`. Não certificam qualidade em jogos, áudio ou replay, nem medem latência óptica entre máquinas.

Reprodução da seleção automática em duas máquinas:

```powershell
node tools/e2e/distributed-matrix.mjs --senders native-auto --receivers chrome --presets balanced --seconds 25 --matched-resolution --matched-codec --bitrate-kbps 4500
```

Para provocar falha apenas no worker filho do aplicativo iniciado pelo E2E, adicionar `--exercise-capture-fallback`. O teste exige D3D12 antes da falha, estado D3D11 depois, frames novos após a troca e preservação de sessão, portas e codec. O modo `native` da matriz continua forçando D3D11 como controle experimental; `native-d3d12` continua forçando D3D12. `native-auto` exercita o novo padrão do produto.
