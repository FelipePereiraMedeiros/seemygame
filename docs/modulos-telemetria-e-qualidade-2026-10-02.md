# Telemetria, diagnóstico e qualidade de transmissão

Data: 2 de outubro de 2026. Implementação no checkout atual; sem publicação ou alteração da produção.

Validação adicional: [CPU/GPU, calibração do instrumento e isolamento dos encoders](medicao-recursos-e-isolamento-cadencia-2026-10-02.md), com resultados de rodadas separadas. As medições abaixo permanecem vinculadas às execuções originais.

## Entrega e uso

O botão **📊 Stats** de cada vídeo abre o HUD com codec efetivamente negociado, resolução entregue, FPS, bitrate e RTT. **Tempos e estabilidade** expõe encode/decode por frame, jitter RTP, atraso médio no jitter buffer, FPS apresentados, frametime p95, maior pausa e implementação do encoder/decoder, quando disponíveis. O gráfico mantém até 120 amostras por conexão, aproximadamente dois minutos. No transmissor com vários espectadores, o seletor permite escolher qual conexão aparece no HUD.

**Exportar diagnóstico** baixa um JSON com o histórico retido da sessão. O botão só é habilitado quando há um monitor associado ao vídeo. Em telas estreitas, o painel tem rolagem própria. A exportação de produção usa uma lista explícita de campos: não inclui SDP, credenciais, candidatos ICE, endereços IP, nomes dos participantes ou contadores brutos. Isso não se aplica ao relatório completo do laboratório E2E, que contém mais informações da execução e deve ser revisado antes de compartilhamento externo.

As configurações de qualidade passam a orientar a captura e os limites do sender. Uma mudança de resolução/FPS no navegador tenta aplicar as constraints e atualiza os parâmetros de envio; uma fonte que rejeita a mudança gera aviso para conferir o resultado no HUD. Uma troca de codec exige reiniciar a transmissão. No nativo, a alteração manual de qualidade usa a reconfiguração existente do worker e pode provocar uma interrupção durante o reinício.

Os perfis 720p120 e 1080p120 são **experimentais**. A seleção do perfil expressa uma solicitação; a homologação depende das medidas de resolução, FPS e apresentação entregues. Os testes desta entrega **não homologaram 120 FPS**.

## O que foi implementado

| Área | Comportamento implementado | Limite relevante |
| --- | --- | --- |
| Métricas WebRTC | Deltas de contadores por identidade RTP/SSRC; codec ativo, resolução, FPS, bitrate, encode/decode, RTT, jitter e perdas | Campo ausente permanece `null`/N/D; a primeira leitura estabelece a base de contadores |
| Apresentação | `requestVideoFrameCallback`, intervalos e pausas, contagem de `presentedFrames` e callbacks perdidos | Não prova scanout físico e não mede latência óptica |
| Histórico e exportação | Até 120 amostras por conexão, até 16 históricos; limpeza ao encerrar a sessão | Um 17º histórico interrompe o monitor mais antigo para manter o limite |
| Hipóteses de gargalo | Encoder, rede, buffer do receptor, apresentação e produção nativa | Classificação com confiança explícita; não é comprovação causal |
| Codec | Preferência por capacidades de envio/recepção, formatos de reparo preservados, negociação SDP e codec real no HUD | Capacidade anunciada não comprova hardware nem disponibilidade no espectador remoto |
| Fallback | Codec indisponível localmente recebe alternativa compatível; rejeição de `setCodecPreferences` restaura a negociação padrão | Não há recuperação automática de todas as falhas de inicialização de encoder em execução |
| Sender | Escritas serializadas, parâmetros e transaction ID relidos; limites de FPS/bitrate e prioridade opcional | Não cria encodings antes da negociação; prioridade de rede não é prioridade de GPU |
| ABR web | Controlador por conexão, teto solicitado, orçamento de encode conforme FPS e cooldown entre mudanças | O congestion control e o pacing RTP continuam sob responsabilidade do navegador |
| Produção nativa | Contador de frames RTP completos, bytes, idade do último frame e maior intervalo desde o início da captura | Mede a saída após encode/packetização, sem separar WGC, conversão e encode |
| Qualificação | Duração, cobertura, dimensão real, visibilidade, FPS p10, apresentação p10 e pausas | Aprovação vale apenas para as condições registradas; não é uma garantia universal |

### Contratos das métricas

- `bitrateMbps`: bytes RTP enviados/recebidos no intervalo. Um teto de 9 Mbps não obriga a transmissão a consumir 9 Mbps.
- `encodeTimeMs` e `decodeTimeMs`: delta do tempo acumulado dividido pelo delta de frames, em milissegundos. São médias do intervalo, não percentis por frame.
- `jitterBufferDelayMs`: delta de atraso acumulado dividido pelos frames/amostras emitidos. O alvo solicitado ao receptor pode diferir do atraso efetivo.
- `rtt`: ida e volta na rede, em milissegundos. Não é latência glass-to-glass nem deve ser somado integralmente como percurso em um sentido.
- `frametimeP95Ms`: distribuição dos intervalos de apresentação observados no callback. Não é o tempo gasto pela GPU para renderizar o jogo.
- `missedCallbacks`: saltos no contador de frames apresentados. Não equivale a frames descartados pelo decoder.
- `producerMaxPauseMs`: maior intervalo entre frames completos na saída RTP nativa durante toda a sessão. Não é uma pausa restrita ao último segundo.
- `producedFps` e `producedBitrateMbps`: produção RTP nativa antes do fanout/ponte remota. Fragmentos do mesmo frame e marcador duplicado não são contados como novos frames.

A ausência do primeiro callback de apresentação aparece como N/D, sem criar um falso zero de startup. Depois do primeiro frame, um intervalo sem novos frames permanece zero FPS e a pausa continua crescendo. Trocas de SSRC e reinícios de contadores não herdam deltas da identidade anterior. As consultas assíncronas não se sobrepõem, e resultados de monitores encerrados são ignorados.

O encoder nativo continua em um subprocesso `gst-launch`. As estatísticas de `webrtcbin` não expõem necessariamente o tempo de encode desse worker nem suas dimensões. Esses valores permanecem N/D. O contador RTP acrescentado mede cadência real sem readback da GPU e sem inventar tempo de encode.

### Seleção de codec

O modo automático conserva H.264 como primeira opção, seguido pelas alternativas anunciadas. AV1 e HEVC são opções explícitas para investigação; não se força uma alternativa apenas por ser mais nova. São consideradas separadamente as capacidades de envio e de decodificação. No nativo, a seleção também verifica os elementos do runtime GStreamer e o decoder anunciado pela WebView.

O receptor remoto ainda participa da interseção pelo SDP. Se a oferta não contiver o codec exigido pelo pipeline nativo, a operação termina com erro explícito para reiniciar com um codec comum, em vez de enviar payload incompatível. O HUD e o relatório do teste identificam o codec efetivo; o nome selecionado na interface não basta como evidência.

O caminho AV1 nativo disponível nesta máquina usa **`svtav1enc` por software**. A presença de AV1 não demonstra NVENC AV1. HEVC nativo depende do encoder e dos elementos de parse/pay/depay completos; o Chrome suportar HEVC não garante esse conjunto no aplicativo.

## Resultados medidos

As execuções abaixo usam transmissor e receptor na **mesma máquina**. São evidências funcionais e de localização do gargalo, com compartilhamento de CPU/GPU, rede local e sem jogo sob carga. Os testes nativos utilizaram binário **debug** e captura de janela sintética. Não representam um teste de rede externa, de áudio/vídeo ou de estabilidade em partida.

### Navegador — encoders e entrega real

O laboratório de qualidade usa dois peers WebRTC reais e uma fonte `canvas.captureStream` com timer. Ele verifica negociação, resolução entregue, cadência, HUD e download do diagnóstico. **Não testa o seletor `getDisplayMedia`, WGC nem o aplicativo Tauri.**

| Execução / condição | Resultado observado | Interpretação |
| --- | --- | --- |
| `quality-2026-10-02T04-15-46-879Z`, 720p60, fonte simples, 5 s | H.264, VP8, VP9, AV1 e HEVC realmente recebidos, aproximadamente 59–60 FPS | Smoke dos codecs; AV1 já reduziu a resolução para 960×540 |
| `quality-2026-10-02T04-19-52-678Z`, 1080p60, fonte simples, 5 s | H.264 e HEVC em 1920×1080, aproximadamente 59–60 FPS; AV1 em 960×540 | AV1 não entregou o perfil pedido, apesar do FPS alto |
| `quality-2026-10-02T04-18-17-118Z`, 720p120, fonte simples, aproximadamente 60 s | Fonte ~120 FPS, FPS decodificados p10 ~100, apresentados p10 ~95,9 | Abaixo do mínimo de 108 FPS para o perfil 120; não homologado |
| `quality-2026-10-02T11-30-43-334Z`, 720p60, fundo dinâmico, 5 s | H.264 e HEVC ~60 FPS em 1280×720; AV1 ~59 FPS, com 480×270/640×360/960×540 | A fonte dinâmica reforça a necessidade de medir a resolução, não só FPS |

O relatório original da execução 120 FPS anterior registrou `insufficient-evidence` por ficar cerca de 1 ms abaixo de 60 s. A regra atual admite até 50 ms de arredondamento nessa fronteira; a mesma evidência continua **reprovada pela cadência**, não se torna homologada. O arquivo original não foi reescrito. A reavaliação separada de navegador e nativo está em `output/playwright/streaming-120-qualification.json`.

O smoke curto com fundo dinâmico foi repetido após corrigir o falso zero anterior ao primeiro callback de apresentação: `quality-2026-10-02T11-43-21-812Z`. O HUD, download e entrega dos três codecs passaram. Havia compilação concorrente nessa rodada final; seus números servem apenas à verificação funcional, não à comparação de desempenho. Nenhum smoke de cinco segundos é tratado como certificação.

A verificação visual final com os tokens reais do tema está em `quality-2026-10-02T11-45-44-951Z/hud-hd60-h264-0.png` e `hud-mobile.png`; o download em `diagnostic-hd60-h264-0.json`. A linha de FPS conserva azul independente do accent do tema; frametime usa linha tracejada para distinção adicional. Essa rodada também é apenas funcional, com compilação concorrente.

### Aplicativo nativo → espectador Chrome

| Execução | Solicitação / codec recebido | Cadência e latência observadas |
| --- | --- | --- |
| `2026-10-02T04-25-09-638Z-51b660` | 720p120 / H.264 NVENC; execução longa | FPS decodificados medianos 53,7; p10 ~52,8. Glass-to-glass p50 37 ms, p99 44 ms. Perfil 120 reprovado |
| `2026-10-02T04-48-43-929Z-745788` | 720p120 / H.264 NVENC; verificação de 15 intervalos | Saída RTP nativa mediana 54,25 FPS; decode 54,73 FPS; apresentação 54,55 FPS. Glass-to-glass p50 37 ms, p99 44 ms |
| `2026-10-02T11-24-59-328Z-d6f4af` | 720p60 / HEVC solicitado, **H.264 recebido** | Fallback funcional; decode mediano 55,0 FPS; glass-to-glass p50 42 ms, p99 49 ms. Não homologa HEVC nativo |
| `2026-10-02T11-29-37-965Z-059374` | 720p60 / **AV1 recebido**, `svtav1enc` | Decode mediano 54,7 FPS; glass-to-glass p50 65 ms, p99 80 ms; última produção RTP ~55 FPS |

Na rodada 120 FPS com o contador novo, a cadência já está em ~54 FPS **antes da ponte WebRTC remota**, e o receptor recebe/apresenta praticamente a mesma quantidade. Isso localiza o limite nesse cenário no segmento fonte/captura/conversão/encode/packetização. Não comprova qual desses estágios é responsável e não justifica culpar rede ou decoder por perder metade dos frames. A próxima investigação precisa de probes dentro do worker, antes e depois da conversão e do encoder.

AV1 funcionou, mas não mostrou vantagem de latência sobre H.264 nesta amostra curta. A diferença entre execuções distintas não isola causalmente o custo do codec. Não é motivo para tornar AV1 o padrão, especialmente com encode por CPU.

O medidor óptico E2E registrou custo p50 de aproximadamente **8 ms por leitura**, mesmo amostrando em cerca de 8 Hz. É interferência material; ele deve ser comparado com uma rodada de instrumentação leve. O HUD de produção não faz leitura de pixels. Não se deve subtrair esses 8 ms automaticamente da latência medida nem tratar mínimos de rede local como limite teórico.

O E2E da sala web também passou em `historical-720p-tree-benchmark-2026-10-02T04-32-19-163Z/observed-720p.json`: entrada autenticada, captura, transmissão direta e entrega 720p. Foi usado `--delivery-only`, um espectador e replay desativado. Esse teste não validou relay nem um cenário de múltiplos espectadores.

## ABR e pacing: alcance e próxima etapa

O ABR do navegador está conectado às métricas outbound de cada peer. O controlador considera perda, RTT, limitação por banda e tempo de encode em relação ao orçamento do perfil: 16,67 ms a 60 FPS e 8,33 ms a 120 FPS. Escritas no sender são serializadas e a recuperação exige amostras consecutivas favoráveis. O ajuste reduz o teto; o navegador pode escolher uma taxa ainda menor. O RTT usa limiares absolutos nesta primeira entrega; uma rota longa estável pode exigir uma política relativa ao RTT basal.

**ABR automático do encoder nativo não foi implementado nesta entrega.** O worker atual é um subprocesso sem canal para alterar a propriedade do encoder em execução. Reconfigurá-lo repetidamente por feedback dos espectadores produziria reinícios e stutters. A mudança manual já funciona; não deve ser apresentada como adaptação automática sem interrupção.

Para completar essa parte de forma adequada:

1. Expor controle em execução do encoder, por pipeline GStreamer em processo ou IPC de propriedades para um worker persistente, sem reconstruir a captura.
2. Medir frames/timestamps na entrada da captura, após conversão e na saída do encoder; medir profundidade e descarte das filas. Manter contadores leves, sem readback por frame.
3. Agregar feedback dos espectadores de um encoder compartilhado. Um peer com perda não deve reiniciar o pipeline de todos; definir orçamento comum e, quando necessário, perfis independentes.
4. Aplicar limites conservadores, cooldown, recuperação e backpressure; validar pacing efetivo e filas sob rede limitada. Não introduzir sleeps em JavaScript como substituto do pacer RTP.
5. Comparar alteração de bitrate em execução com o controle sem ABR, verificando continuidade, latência, perda, qualidade visual e custo de CPU/GPU.

O pacing WebRTC permanece no navegador e no `webrtcbin`. A entrega melhora os limites e a serialização do controle; não implementa um pacer RTP próprio. Tampouco altera o escalonador do Windows para garantir prioridade sobre o jogo. Atributos `priority`/`networkPriority` do sender não são garantia de prioridade CPU/GPU.

## Testes e reprodução

### Verificação do código

Suíte final: **916 testes JS em 90 arquivos**, incluindo regressões de counters/SSRC, privacidade, lifecycle, apresentação, codec/fallback, serialização de parâmetros, orçamento de encode, hipóteses e qualificação. **13 testes Rust** específicos passaram: 11 da ponte e 2 do contador RTP. `cargo check`, build nativo, build de distribuição, grafo de módulos, HTML/CSS e smoke ESM também passaram.

Logs em `output/playwright/streaming-full-tests.log`, `streaming-rust-tests.log`, `streaming-rtp-tests.log`, `streaming-native-check.log`, `streaming-native-build.log` e `streaming-build.log`. O smoke ESM exclui `js/theme.js`, que é um bootstrap clássico intencional executado antes dos estilos no HTML.

```powershell
npm test
npm run check:modules
npm run check:html
npm run check:css
npm run test:smoke
npm run build:dist
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib webrtc_bridge
cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib rtp_stats
```

### Laboratório de codec/qualidade

```powershell
# Verificação rápida de negociação e resolução real
npm run test:e2e:quality -- --channel chrome --profiles hd60 --codecs h264,av1,hevc --seconds 5 --scene motion

# Comparação repetida com fonte dinâmica: sem builds ou outros benchmarks concorrentes
npm run test:e2e:quality -- --channel chrome --headed --profiles hd60,fhd60,hd120,fhd120 --codecs h264,av1,hevc --seconds 60 --repeat 3 --scene motion
```

O relatório registra hardware básico, versão do navegador, topologia, origem sintética, hashes do frontend, perfil pedido, parâmetros, métricas intervalares, codec/resolução real e status de qualificação. Alterna a ordem de perfis/codecs entre repetições. Um codec não anunciado aparece como `unsupported`. O `status: passed` global significa entrega funcional sem erro; **não equivale à homologação de cada perfil**. Conferir `run.assessment.status` e `run.summary.qualification`.

A regra mínima exige aproximadamente 60 s medidos, pelo menos 80% de cobertura esperada a 1 Hz, dimensões corretas em todas as amostras válidas, vídeo visível, codec ativo, decode/apresentação p10 ≥90% do FPS pedido e maior pausa ≤máximo entre 50 ms e quatro períodos de frame. É uma regra de aceitação declarada, não uma definição universal de streaming fluido.

### Fluxo real nativo

```powershell
npm run build:dist
cargo build --manifest-path src-tauri/Cargo.toml --locked --offline --release
node tools/e2e/run.mjs --exe src-tauri/target/release/seemygame.exe --channel chrome --preset ultra --codec h264 --seconds 60
node tools/e2e/run.mjs --exe src-tauri/target/release/seemygame.exe --channel chrome --preset hd120 --codec h264 --seconds 60
node tools/e2e/run.mjs --exe src-tauri/target/release/seemygame.exe --channel chrome --preset ultra --codec av1 --seconds 60
```

O harness verifica o frontend embutido, abre aplicativo e navegador isolados, autentica ambos na mesma sala, seleciona a janela sintética exclusiva da execução, transmite, coleta telemetria e encerra a captura. Registra `native-diagnostic.json`/`web-diagnostic.json` além do relatório óptico. `--codec` aceita `auto`, `h264`, `av1`, `hevc`. Conferir `nativeState.videoCodec` e o codec do receptor para detectar fallback.

### Matriz que falta para homologação de uso real

| Eixo | Condições necessárias |
| --- | --- |
| Topologia | Duas máquinas, LAN controlada e rota externa; especificar RTT, perda e limite de banda |
| Carga | Sem jogo; jogo sem limite de FPS; jogo com limite; mesmas cenas/configurações |
| Perfil | 720p60 e 1080p60 como referência; 120 FPS apenas com fonte e apresentação verificadas |
| Codec | Codec efetivo, resolução entregue, encoder/decoder e aceleração confirmados |
| Áudio | Sem áudio e WASAPI/Opus com áudio; medir jitter, continuidade e sincronismo A/V |
| Replay | Desativado para isolar transmissão; depois ativado em rodada separada |
| Instrumentação | HUD leve; óptica a 8 Hz em rodada separada para estimar interferência |
| Duração | Pelo menos 3–5 repetições de 60 s estáveis, preferencialmente release; alternar ordem |
| Aceitação | FPS p10, pausas/frametime, p50/p90/p99 de latência, resolução/qualidade, perda, filas e uso de CPU/GPU |

Não executar compilação, Vitest, outra E2E ou estresse incidental durante a medição. Guardar os resultados brutos por execução; não somar médias de estágios para explicar diferenças de medianas glass-to-glass. A comparação entre máquinas exige sincronização/calibração dos relógios ou outro método de referência óptica: o `Date.now()` atual, seguro na mesma máquina, não oferece essa garantia sozinho.

## Arquivos principais

- `js/stats/{metrics,presentation,monitor,hud,diagnostic,diagnosis}.js`: medição, visualização e exportação.
- `js/streaming/{codecs,sender-parameters,quality,adaptation,settings-controller}.js`: política de qualidade, capabilities, sender e gate de qualificação.
- `js/capture/settings.js`, `js/webrtc/sender.js` e sessões room/streamer: integração real com captura e envio.
- `src-tauri/src/webrtc_bridge/stats.rs`, `src-tauri/src/media/rtp_stats.rs`, captura/fanout e comando `get_native_stream_stats`: telemetria nativa sem pixels por IPC.
- `tools/e2e/quality-benchmark.mjs` e `tools/e2e/run.mjs`: laboratório e fluxo real.
- `tests/streaming-telemetry.test.js`: regressões dos novos contratos.

## Referências primárias

- [W3C WebRTC Statistics](https://www.w3.org/TR/webrtc-stats/): definição e disponibilidade dos contadores.
- [W3C WebRTC](https://www.w3.org/TR/webrtc/): capacidades, codec preferences e parâmetros dos transceivers/senders.
- [GStreamer webrtcbin](https://gstreamer.freedesktop.org/documentation/webrtc/): transporte e estatísticas da ponte.
- [GStreamer d3d11screencapturesrc](https://gstreamer.freedesktop.org/documentation/d3d11/d3d11screencapturesrc.html): captura WGC/DXGI e caps; framerate permitido nas caps não comprova cadência entregue.
- [Chrome 136 beta](https://developer.chrome.com/blog/chrome-136-beta): suporte HEVC no WebRTC em plataformas compatíveis; validar capacidades do ambiente efetivo.
