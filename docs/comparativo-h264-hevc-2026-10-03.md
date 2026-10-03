# Comparativo H.264 × H.265/HEVC — 03/10/2026

## Escopo e método

Comparação do núcleo nativo com transmissão direta para o Chrome no notebook, em 1920×1080, alvo 60 FPS, teto 4.500 kbps, janela sintética em movimento, áudio/replay desligados. Há três condições: H.264 com preferência automática (D3D12/NVENC nesta GPU), H.264 via Media Foundation com captura D3D11 como controle, e HEVC via Media Foundation/D3D11. Duas repetições de 70 intervalos, em ordem invertida na segunda, perfis novos por execução e medição de CPU/GPU nas duas máquinas.

Captura D3D11 + Media Foundation nos dois codecs reduz a confusão entre mudança de codec e mudança de captura/API do encoder. Mesmo nesse controle, H.264 constrained-baseline e HEVC main têm ferramentas de compressão diferentes; o teste não iguala qualidade perceptual. O modo padrão H.264 também é medido para responder qual caminho disponível entrega melhor cadência.

Todos os casos do comparativo usam **o mesmo adaptador diagnóstico sem prévia local** e ofertas do receptor restritas ao codec solicitado, com payloads de vídeo 96–127. Captura, encoder, fanout, ponte WebRTC, rede e vídeo do espectador são reais. O canvas local apenas satisfaz o ciclo de vida da interface; não é a fonte dos frames transmitidos. A verificação exige zero chamadas de mídia de tela no navegador e uma conexão nativa direta, codec negociado correto e resolução correta em todos os intervalos estáveis.

Esse comparativo não representa o fluxo completo com prévia do produto. A latência óptica não é medida entre relógios independentes; tempo de decode, jitter buffer e RTT são componentes observáveis, não substitutos de glass-to-glass. Não há SSIM/VMAF, vídeo de jogo nem saturação controlada de GPU nesta bateria. Menor bitrate recebido, sozinho, não prova igual qualidade com maior eficiência.

## Bloqueios encontrados antes de medir

1. **Fallback da prévia no WebView2.** A instância 154.0.4258.48 no transmissor não anuncia H.265 em `RTCRtpReceiver.getCapabilities('video')`, enquanto o Chrome 154.0.8037.58 do notebook anuncia H.265 nos perfis 1 e 2. `NativeCaptureProvider.start()` intersecta as capacidades nativas com o decoder local e substitui o pedido HEVC por H.264. O guard de codec rejeitou a execução, evitando comparar dois H.264 como se fossem codecs diferentes.
2. **Payloads RTP baixos oferecidos pelo Chrome.** Depois de remover a prévia no diagnóstico, o encoder HEVC produziu vídeo real, mas a ponte falhou ao conectar `seemygame-video-pay` ao capsfilter. O Chrome usa H.265/RTX nos PTs 49–52, enquanto o template de `rtph265pay` local anuncia 96–127. Uma prova finita com `pt=49` chegou a EOS, mas negociou efetivamente PT 96. A documentação e implementação do payloader devem ser consideradas junto dos caps negociados; a faixa aceita pela propriedade sozinha não comprova suporte efetivo.

O adaptador E2E normaliza a oferta, preservando codec, fmtp, feedback e RTX `apt`, evitando colisões inclusive com áudio. Esses ajustes ficam no teste; **não são uma correção do produto em produção**. O código do núcleo nativo/encoder não foi alterado nesta comparação.

Artefatos de investigação, excluídos da comparação de desempenho:

- `matrix-2026-10-03T03-19-35-587Z-95d90e`: pedido HEVC recebido como H.264; guard rejeitou.
- `matrix-2026-10-03T03-22-20-418Z-bcaf4e`: capacidades completas confirmaram a ausência de HEVC no WebView2 e presença no Chrome.
- `matrix-2026-10-03T03-24-04-811Z-f2fff5`: habilitação experimental de `WebRtcAllowH265Receive` apenas no WebView2 isolado não mudou as capacidades.
- `matrix-2026-10-03T03-26-36-496Z-b20eea`: sem prévia, houve erro de caps RTP; não entregou vídeo.
- `matrix-2026-10-03T03-33-17-626Z-07d61d`: prova funcional HEVC após normalização SDP, 1080p, p50 54,93 FPS; rodada curta, não homologação.

## Resultados medidos

Bateria concluída: `output/playwright/codec-comparison-2026-10-03T03-35-48-125Z-0bc630/report.json`. Todos os seis casos passaram a verificação funcional de transporte, codec e resolução. Cada um teve aproximadamente 68 segundos estáveis; **nenhum passou todos os critérios de qualificação de qualidade**, inclusive o melhor H.264, devido à apresentação/frametime. `passed` no runner significa execução funcional, não homologação de fluidez.

| Condição / repetição | FPS decode p50 / p10 | FPS apresentado p50 | Bitrate recebido p50 (Mbps) | Decode p50 (ms) | Jitter buffer p50 (ms) | Intervalos com stutter | Pacotes perdidos, contador final |
| --- | --- | --- | --- | --- | --- | --- | --- |
| H.264 D3D12/NVENC / 1 — carga externa | 59,97 / 51,00 | 54,11 | 1,868 | 0,833 | 11,88 | 8 | 1 |
| H.264 D3D11/MF / 1 | 54,99 / 54,36 | 49,02 | 1,893 | 0,774 | 12,06 | 0 | 0 |
| HEVC D3D11/MF / 1 | 54,98 / 54,29 | 48,97 | 1,975 | 0,775 | 10,16 | 1 | 4 |
| HEVC D3D11/MF / 2 | 54,88 / 54,10 | 49,01 | 1,955 | 0,791 | 11,65 | 4 | 186 |
| H.264 D3D11/MF / 2 | 54,91 / 54,25 | 49,00 | 1,799 | 0,775 | 11,78 | 1 | 14 |
| H.264 D3D12/NVENC / 2 | 60,11 / 59,12 | 55,06 | 1,778 | 0,776 | 10,16 | 0 | 2 |

Stutters são intervalos estáveis marcados pelo detector de pausas, não contagem de todos os frames descartados. Pacotes perdidos são contadores finais da sessão, incluindo aquecimento; o relatório bruto contém os deltas por intervalo. A ausência de stutters não implica apresentação perfeita: no H.264 padrão da segunda repetição, apresentação p10 foi 53,03 FPS, frametime p95 35,2 ms e pausa máxima de qualificação 106,5 ms. A mediana de FPS do decoder não representa a cadência do display.

### Pressão de recursos e interferências

Percentuais abaixo são do total de CPU da máquina, não de um único núcleo. As colunas de processos identificam o worker nativo e o Chrome pertencente ao E2E. GPU é o motor mais ocupado do sistema; não mede exclusivamente o encoder/decoder, e motores distintos não podem ser somados.

| Condição / repetição | Worker CPU p95 | Chrome receptor CPU p95 | CPU total host / receptor p95 | GPU host / receptor p95 |
| --- | --- | --- | --- | --- |
| H.264 padrão / 1 — carga externa | 1,81% | 6,68% | 41,22% / 100% | 7,82% / 19,19% |
| H.264 MF / 1 | 1,56% | 3,80% | 69,88% / 20,92% | 7,13% / 16,46% |
| HEVC MF / 1 | 1,82% | 3,80% | 38,89% / 15,33% | 6,86% / 26,11% |
| HEVC MF / 2 | 1,84% | 3,86% | 43,23% / 17,96% | 6,87% / 26,12% |
| H.264 MF / 2 | 1,81% | 4,22% | 49,20% / 15,48% | 7,20% / 16,86% |
| H.264 padrão / 2 | 2,08% | 3,52% | 43,67% / 19,04% | 7,78% / 18,16% |

A primeira rodada H.264 padrão sofreu saturação no notebook por um `node.exe` externo ao E2E, além de pressão de memória. CPU externa p95 foi 87,13%, com alertas de CPU alta, núcleo ocupado, pouca memória livre e coleta lenta. O processo já havia encerrado na conferência posterior; nenhum processo pessoal foi interrompido. Essa rodada permanece registrada, mas foi excluída da conclusão comparativa de estabilidade. A repetição seguinte desse mesmo caminho não teve esses alertas. Ainda há variação de carga externa nas outras rodadas: não se deve atribuir a diferença de CPU total ao codec.

Na segunda rodada HEVC, os quatro intervalos com stutter coincidiram com perdas RTP e NACK: segundos 7, 14, 15 e 16, com 5, 4, 138 e 39 pacotes perdidos respectivamente. As pausas foram 300, 508, 473 e 528 ms. Isso sustenta investigar perda/recuperação nessa rodada, sem provar que HEVC tenha provocado a perda. A rota foi UDP host→host, RTT mediano 7–8 ms; esta não foi uma simulação de WAN ou teste controlado de perda.

### Parecer

1. **O melhor caminho disponível nesta máquina continua sendo H.264 D3D12/NVENC.** Na rodada sem saturação externa do receptor, ficou próximo de 60 FPS decodificados e sem stutter detectado. Isso não demonstra vantagem intrínseca do codec: captura e API do encoder também mudam.
2. **No controle D3D11/MF, H.264 e HEVC empataram na cadência e no decode.** Medianas de 54,88–54,99 FPS, apresentação perto de 49 FPS e decode de 0,77–0,79 ms. Trocar somente o codec não resolveu a diferença para o alvo de 60 FPS. É necessário medir cadência na saída da captura, conversão e encoder para localizar onde ela surge.
3. **HEVC não economizou tráfego nesta configuração/cena.** Recebeu 1,95–1,98 Mbps contra 1,80–1,89 Mbps do H.264 MF, apesar do mesmo teto de 4,5 Mbps. Não há avaliação de qualidade: HEVC pode estar entregando detalhe diferente, e o teto não implica consumo efetivo igual. Não é uma refutação geral da eficiência do HEVC.
4. **Não há evidência de menor latência glass-to-glass do HEVC.** O instrumento óptico foi desativado entre máquinas com relógios independentes. Decode/jitter/RTT não podem ser somados para inventar esse resultado; faltam também timestamps instrumentados de encode nativo. `decoderImplementation` e `powerEfficientDecoder` não foram expostos, portanto não se afirma qual decoder o Chrome usou apenas a partir desses campos.
5. **HEVC permanece experimental no produto.** O resultado funcional foi obtido com adaptação E2E explicitamente documentada. Antes de oferecer HEVC como padrão, corrigir a dependência da prévia local e a negociação de payloads no fluxo real.

### Próximos testes com maior valor

- Corrigir e testar os dois bloqueios de HEVC no produto, incluindo áudio/RTX, reconexão e fallback para receptor sem suporte. Repetir depois sem adaptadores diagnósticos.
- Comparar a mesma sequência de frames por qualidade e taxa: 720p/1080p, 2/4,5/8 Mbps, qualidade perceptual e legibilidade, com captura de referência e alinhamento de frames. Medir VMAF/SSIM e bitrate efetivo; cenário sintético sozinho não representa jogo.
- Instrumentar a saída da captura, entrada/saída do encoder e RTP, com timestamps correlacionáveis, para separar o limite observado do caminho D3D11/MF do codec. Medir latência visual com fonte/receptor no mesmo relógio ou câmera externa; não comparar timestamps absolutos de máquinas sem calibração.
- Aplicar CPU/GPU e perda de rede controladas separadamente, com áudio ligado em outra bateria. Observar p10 de apresentação, frametime p95/p99, recuperação após NACK/PLI, e qualidade antes de recomendar um codec por FPS mediano.

### Artefatos das seis rodadas, na ordem executada

1. `2026-10-03T03-35-57-923Z-16e3de/report.json` — H.264 padrão, carga externa.
2. `2026-10-03T03-38-09-297Z-9a9bcf/report.json` — H.264 MF.
3. `2026-10-03T03-40-16-230Z-7969fb/report.json` — HEVC MF.
4. `2026-10-03T03-42-22-577Z-54284d/report.json` — HEVC MF.
5. `2026-10-03T03-44-29-197Z-7f6898/report.json` — H.264 MF.
6. `2026-10-03T03-46-35-201Z-40e7d2/report.json` — H.264 padrão.

Todos ficam em `output/playwright/`. Resumo reprocessável: `codec-comparison-2026-10-03T03-35-48-125Z-0bc630/summary.json`.

Validação do harness: três arquivos, dez testes aprovados, incluindo preservação de fmtp/RTX, colisões com payload de áudio, ofertas somente de voz, rejeição de HEVC ausente e validação de codec/backend real. A bateria usou o executável release existente com hash invariável. As novas verificações de hash dos adaptadores e rejeição de codec `auto` no modo sem prévia foram adicionadas após a bateria para fortalecer futuras execuções; não alteraram os dados já coletados.

Após a bateria, sintaxe dos seis módulos envolvidos e `git diff --check` passaram. Cleanup conferido: zero tarefas E2E, zero processos identificados desta bateria e zero listeners de controle 19333/19334 no notebook; zero listeners desses controles no desktop. Checkout mantido em `dev`.

## Verificação adicional: HEVC com memória D3D12

Após a comparação, foi verificado que a restrição D3D12/H.264 vem do código atual (`CaptureBackend::resolve` e `build_pipeline`), não de uma incompatibilidade geral entre HEVC e D3D12. O GStreamer 1.28.7 instalado expõe `nvh265enc` com entrada `D3D12Memory` e `nvd3d11h265enc` com entrada `D3D11Memory`. `d3d12h265enc` não está registrado nesse runtime, mas esse nome de elemento não é necessário para codificar HEVC a partir de memória D3D12.

Uma prova local finita executou 30 frames sintéticos NV12 1920×1080 via `d3d12upload → D3D12Memory → nvh265enc → h265parse → fakesink`, com bitrate 4500, GOP 30, CBR, preset P1, sem B-frames e ajuste de baixa latência. Terminou em EOS, exit code 0, na RTX 3070. Houve avisos de scanner de plugins e módulo GIO ausente; a cadeia utilizada carregou e executou. Isso comprova a possibilidade de encode nessa máquina, **não** captura WGC, transmissão WebRTC, desempenho em tempo real, ausência de cópias internas ou compatibilidade da prévia.

O próximo candidato é `d3d12screencapturesrc → d3d12convert/NV12 → nvh265enc → H.265/RTP`. Outra alternativa é interop D3D12→D3D11 antes de `mfh265enc` ou `nvd3d11h265enc`, semelhante ao caminho H.264 atual. A comparação anterior não mediu nenhum desses caminhos HEVC/D3D12. Referência: [nvh265enc e formatos de memória aceitos](https://gstreamer.freedesktop.org/documentation/nvcodec/nvh265enc.html).

## Reprodução da bateria comparativa

```powershell
node tools/e2e/codec-comparison.mjs --seconds 70 --repeat 2 --presets balanced --bitrate-kbps 4500
```

O runner verifica se o hash do executável mudou durante a bateria. Cada caso valida o frontend embutido contra o checkout e salva hashes de código, versão do navegador, pipeline realmente iniciado, recursos e resultados. Compilação e testes unitários devem ocorrer fora das janelas de medição.

Referências técnicas: [Media Foundation H.265](https://gstreamer.freedesktop.org/documentation/mediafoundation/mfh265enc.html), [Media Foundation H.264](https://gstreamer.freedesktop.org/documentation/mediafoundation/mfh264enc.html), [NVENC D3D11 H.264](https://gstreamer.freedesktop.org/documentation/nvcodec/nvd3d11h264enc.html), [Chromium: descoberta de codecs de recepção](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/peerconnection/rtc_video_decoder_factory.cc), [GStreamer 1.28: negociação do payloader](https://raw.githubusercontent.com/GStreamer/gstreamer/1.28/subprojects/gst-plugins-base/gst-libs/gst/rtp/gstrtpbasepayload.c), [RFC 5761, escolha de payload types](https://www.rfc-editor.org/rfc/rfc5761.html#section-4).
