# Captura nativa e transmissão: análise de latência

Revisão em 16/09/2026. Sintoma informado: atraso na imagem recebida pelo espectador. Análise do código atual, propriedades dos plugins instalados, log local anterior e teste sintético novo. Não houve captura da tela/microfone nem conexão com espectadores nesta revisão. Nenhuma alteração de produção foi aplicada.

## Conclusão técnica

A implementação atual acrescenta uma cadeia de mídia completa antes da transmissão que já existia na versão web. A principal hipótese é o custo combinado de recepção local, decodificação, recodificação e disputa por recursos, agravado por configuração de qualidade que não chega ao worker. A hipótese é consistente com o código; não há medição ponta a ponta suficiente para atribuir uma quantidade de milissegundos a cada causa.

O encoder H.264 isolado não apresentou atraso alto no teste sintético desta máquina. Isso muda a prioridade da investigação: começar por ponte local, replay, resolução efetiva e encoder WebRTC de saída. Não presumir que WGC ou Media Foundation sejam o gargalo.

## Caminhos comparados

```text
WEB
getDisplayMedia → trilha capturada → encoder WebRTC → rede
  → jitter buffer do espectador → decoder → apresentação

NATIVO ATUAL
WGC → D3D11/BGRA → D3D11/NV12 → encoder Media Foundation
  → RTP/UDP → depay/pay → webrtcbin → WebRTC local
  → jitter buffer do WebView → decoder do WebView → MediaStream
  → encoder WebRTC/PeerJS → rede
  → jitter buffer do espectador → decoder → apresentação

CARGA PARALELA
MediaStream → MediaRecorder de replay, no host e nos espectadores
```

A ponte Rust não decodifica o vídeo: ela desempacota e reempacota RTP. A etapa adicional de decodificação fica no WebView. Entregar esse MediaStream ao PeerJS não implementa encaminhamento transparente dos pacotes H.264 originais. A codificação de saída é uma nova etapa. O áudio também passa por Opus, recepção local e envio WebRTC novamente.

Referências centrais: `src-tauri/src/media.rs:537`, `src-tauri/src/webrtc_bridge.rs:96`, `js/native-webrtc.js:78`, `js/app.js:1963`.

## Evidências medidas e seus limites

### Log real anterior

Arquivo: `src-tauri/target/release/native_debug.log`, última alteração em 16/09 às 13:19. O executável release encontrado é das 13:04. O log não identifica hash do código nem contém estatísticas do espectador; portanto não comprova que o binário corresponde integralmente ao checkout atual.

Na última sessão H.264 com áudio de sistema:

- 225 amostras, aproximadamente 336 segundos entre a primeira e a última.
- Resolução observada: 1920×1080 após o início da mídia.
- Média das taxas de decodificação por intervalo: 59,17 FPS; menor intervalo: 35,29 FPS. Variações do timer afetam máximos instantâneos.
- Média das taxas recebidas por intervalo: 4,19 Mbps; houve rajadas de até 11,68 Mbps nessa janela de amostragem.
- RTT da conexão local observado próximo de 0–1 ms. Isso não é a latência visual nem a RTT até o espectador.
- A interface registrou “trilhas confirmadas” em 1789575220683. A amostra em 1789575222187 ainda tinha zero bytes e zero frames; a seguinte, em 1789575223685, já tinha frames. Existe confirmação prematura de sucesso antes de mídia efetiva.
- A diferença final `framesReceived - framesDecoded` foi 69. Não converter esse contador acumulado em 1,15 s de atraso: ele pode incluir frames descartados e não representa necessariamente uma fila pendente.

60 FPS também não significa baixa latência: uma fila pode entregar 60 quadros/s constantemente, todos atrasados.

### Teste sintético executado nesta revisão

Fonte artificial `videotestsrc`, 120 buffers, 1920×1080/60, imagem de bola em movimento. Caminho: BGRA → upload D3D11 → conversão NV12 → fila de um buffer → mfh264enc → h264parse → rtph264pay → fakesink. Mesmos parâmetros H.264 de baixa latência do worker, sem áudio.

| Medida pelo tracer | Amostras | Mediana | p95 | Máximo |
| --- | ---: | ---: | ---: | ---: |
| Fonte até sink | 119 | 3,85 ms | 4,60 ms | 44,22 ms |
| mfh264enc | 119 | 2,87 ms | 3,47 ms | 5,82 ms |
| Fila antes do encoder | 119 | 0,043 ms | 0,055 ms | 8,00 ms |

Arquivos: `docs/latencia-sintetica-h264-1080p.log` e `docs/latencia-sintetica-h264-1080p.json`. O processo concluiu com código 0. Houve avisos de scanner/plugins opcionais ausentes. Os 119 registros do tracer para 120 buffers não devem ser interpretados isoladamente como uma contagem de perda.

Esse é um teste curto, de conteúdo simples, sem jogo concorrente. Não inclui WGC, captura real, áudio, UDP, ponte WebRTC, replay, envio remoto, decoder do espectador ou display. Os números não representam a latência da aplicação. O tracer mede o percurso de eventos e buffers no pipeline; não substitui uma medição visual ponta a ponta. [Tracer oficial](https://gstreamer.freedesktop.org/documentation/coretracers/latency.html).

## Achados por etapa

### 1. Alto impacto: recodificação obrigatória na arquitetura atual

**Confirmado no fluxo.** O WebView recebe a mídia nativa e `peer.call(viewerPeerId, localStream)` a envia novamente. Mesmo quando o encoder nativo é rápido, a cadeia ganha recepção, jitter buffer e decoder antes do encoder remoto. Pode haver cópias de superfícies e competição entre encoders; sua intensidade precisa ser medida, especialmente com o jogo usando a GPU.

**Otimização estrutural:** conectar o encoder nativo ao transporte WebRTC dos espectadores, mantendo JS para controle/sinalização. Não basta substituir a chamada PeerJS: é necessário preservar autorização, negociação, RTCP, retransmissão, ICE/TURN, adaptação e ciclo de vida. Manter uma prévia local opcional, sem torná-la o caminho obrigatório da transmissão.

### 2. Alto impacto: perfil selecionado não controla a captura nativa

**Confirmado.** `NativeCaptureProvider.start` e `start_native_capture` aceitam fonte, áudio, codec e cursor; não aceitam resolução, FPS ou bitrate do perfil. `MediaWorkerConfig` usa 60 FPS e 8.000 kbps por padrão, alteráveis por variáveis de ambiente. Os caps não limitam largura/altura.

No web, o pedido de captura tem teto de 1920×1080. No nativo, uma fonte 1440p/4K pode ser convertida, codificada e decodificada inteira antes da redução no encoder de saída. Mudar para 720p na interface não reduz esse trabalho inicial. Aplicar constraints a uma trilha remota não controla o produtor Rust.

**Ação:** passar um perfil validado ao worker e redimensionar na GPU antes da primeira codificação. Preservar proporção e dimensões pares. Reportar resolução/FPS efetivos, não apenas o perfil solicitado. A adaptação de saída por espectador deve continuar separada do perfil compartilhado de captura.

### 3. Alto impacto potencial: replay sempre ligado e VP9 preferencial

**Confirmado o custo adicional; impacto ainda não medido.** `app.js:2494` inicia replay automaticamente no host; `app.js:2080` faz o mesmo em cada stream recebido. `clipping.js:26` prioriza VP9. Não há escolha de orçamento de resolução/FPS/bitrate para gravação.

Com captura nativa, há encoder nativo, encoder de saída e MediaRecorder concorrendo. O espectador também grava o que recebe. A disponibilidade de VP9 não garante aceleração por hardware. É uma causa plausível de saturação, quedas e aumento de fila mesmo com a rede boa.

**Ação imediata para A/B:** replay desligado nos dois lados; depois ativar um lado de cada vez. Torná-lo opcional ou gravar a mídia já codificada no nativo, evitando outra codificação. Não assumir que trocar VP9 por outro codec resolverá sem medir CPU/GPU e qualidade.

### 4. Alto impacto potencial: receptor da ponte não recebe ajustes de baixa latência

**Confirmado.** `applyTransceiverOptimizations` ajusta os receivers das chamadas remotas, mas `js/native-webrtc.js` cria outra RTCPeerConnection e não aplica esses ajustes ao receiver local. A ponte tem um buffer adaptativo adicional antes da transmissão externa.

**Ação:** configurar e medir separadamente `jitterBufferTarget`/`playoutDelayHint` quando suportados no WebView. São alvos/sugestões, não promessa de zero atraso. Medir o tempo efetivo com diferenças dos contadores de jitter buffer.

**Cuidado:** `gst-inspect` informa `webrtcbin.latency=200 ms` por padrão. Isso se refere aos jitter buffers de recepção do GStreamer. Nesta arquitetura ele está enviando vídeo; não há evidência para atribuir automaticamente 200 ms de atraso de saída a essa propriedade. Alterá-la cegamente pode não melhorar nada. [Documentação do webrtcbin](https://gstreamer.freedesktop.org/documentation/webrtc/index.html).

### 5. Recuperação incompleta de perdas e pedidos de keyframe

**Confirmado estruturalmente.** Entre o worker e a ponte há somente RTP/UDP. Não há caminho de feedback até o encoder do worker. PLI/force-key-unit recebido na ponte não atravessa automaticamente o limite de processo e o socket UDP até `mfh264enc`.

Perder partes de um frame ou do keyframe inicial pode causar congelamento/corrupção até o próximo IDR periódico. O GOP configurado é `max(fps,30)`: aproximadamente um segundo em 60 FPS, mas três segundos se o FPS for 10. Não confundir intervalo de GOP com atraso permanente de todos os quadros.

**Ação:** preservar pedidos de keyframe até o encoder, idealmente em pipeline integrada; se houver processos separados, criar canal explícito de controle. Validar perda induzida e recuperação. `rtph264depay.request-keyframe` sozinho não resolve a ausência desse canal. [Propriedades oficiais](https://gstreamer.freedesktop.org/documentation/rtp/rtph264depay.html).

### 6. Inicialização envia mídia antes de existir receptor pronto

**Confirmado.** Worker começa antes da oferta do browser. A ponte passa por PAUSED/PLAYING e espera coleta ICE; browser também espera coleta por até três segundos. Mídia produzida cedo pode ser perdida antes do bind ou acumular no socket durante a negociação.

Isso afeta principalmente primeiro frame e recuperação inicial, não comprova atraso constante durante a sessão. O log mostra trilha negociada antes de bytes/frames. Solicitar IDR quando o transporte estiver pronto e só indicar transmissão funcional depois do primeiro frame recebido/decodificado. Trickle ICE pode reduzir espera, desde que ordenação e candidatos sejam corretamente tratados.

### 7. UDP local limita o que pode ser observado e controlado

**Confirmado:** `udpsrc` configura apenas porta e caps. Não existe política explícita de buffer do socket, detector de pacotes perdidos ou descarte de frames antigos. A fila de um buffer antes do encoder é boa, mas não limita filas posteriores no socket, transporte ou browser.

Não adicionar descarte arbitrário de pacotes H.264: isso pode destruir frames de referência. Medir backlog e perdas, restringir bind a loopback, reservar portas corretamente e preferir descarte de frames brutos antes do encoder ou recuperação por keyframe. Aumentar buffer indefinidamente pode reduzir perdas e piorar atraso. [udpsrc](https://gstreamer.freedesktop.org/documentation/udp/udpsrc.html).

### 8. Relógios e sincronismo A/V precisam de validação

**Risco de projeto, não atraso comprovado.** Vídeo e áudio saem do worker por RTP separado, sem canal RTCP entre worker e ponte, são desempacotados e recebem nova packetização. A ponte usa outro pipeline/relógio. Deve-se verificar como os timestamps de captura e a relação temporal A/V são preservados; timestamps de chegada não equivalem a timestamps da captura.

Usar estímulo visual e sonoro simultâneo e medir drift durante sessão longa. Opus nativo tem `frame-size` padrão de 20 ms, confirmado no plugin instalado; há outra etapa Opus no envio remoto. Experimentar pacotes menores só após medir o custo de CPU/rede e sincronismo. Não somar durações nominais e apresentar o resultado como latência medida.

### 9. ABR por espectador não está integrado; gargalo de CPU fica invisível

**Confirmado.** `app.js:1974` chama `processSample` sem `viewerPeerId`; métricas ausentes viram zero por `|| 0`. `app.js:3155` muda o bitrate global e reaplica a todas as chamadas. Um espectador ruim reduz todos; vários espectadores alimentam o mesmo contador de recuperação. `applyMeshGuard` existe no módulo, mas não é chamado pela aplicação.

Além disso, o controle reage a RTT/perda. Não reage ao tempo de codificação, backlog, frames descartados ou `qualityLimitationReason=cpu`. E o worker nativo permanece no perfil fixo, mesmo quando a saída é reduzida.

**Ação:** identificar o peer nas amostras e callbacks, preservar valores ausentes, impor orçamento total de upload e recursos. Separar adaptação de rede por receptor da redução compartilhada de carga de captura.

### 10. Seleção de codec e resolução pode divergir do que a interface sugere

**Confirmado:** codec escolhido chega ao worker; a chamada externa executa `applyTransceiverOptimizations` sem passar a escolha e usa H.264 por padrão. É possível selecionar HEVC/AV1 para o trecho local e transmitir H.264 ao espectador. Isso soma custo de transcodificação sem assegurar benefício de banda externa.

A ponte escolhe payload pelo nome do codec, sem validar todo o perfil/nível/packetization-mode H.264. Ofertas com várias variantes exigem correspondência real com o encoder. Se o codec não existe na oferta, há fallback para o payload numérico do worker, que não representa negociação válida.

A escala do sender usa `getSettings().height || 1080`. Antes do primeiro frame a dimensão pode não estar disponível, e `applySenderOptimizationsWhenReady` encerra tentativas após sucesso de parâmetros, não após confirmar resolução. Validar resolução efetivamente enviada depois do início, sem confiar no fallback.

### 11. AV1 tem defeitos antes de qualquer otimização fina

**Confirmado:** codificador `svtav1enc` é software, com download GPU→RAM. Há `config-interval` aplicado a `rtpav1pay`, propriedade ausente na versão instalada. Existe também transição NV12 → download → caps I420 sem conversor explícito; deve ser validada como negociação real, não por teste de strings. `d3d11download` transfere memória; não deve ser presumido como conversor de formato. [Documentação oficial](https://gstreamer.freedesktop.org/documentation/d3d11/d3d11download.html).

Manter H.264 como referência dos testes. Não considerar AV1 uma otimização de latência por ser um codec mais novo. No caso H.264 observado no log, esses defeitos AV1 não explicam o atraso relatado.

### 12. Adaptadores de GPU e concorrência não são registrados

**Lacuna.** WGC usa adapter padrão; encoder Media Foundation é descoberto pelo runtime. O plugin expõe LUID do adaptador, mas a aplicação não correlaciona esse valor com a GPU usada pelo WebView/jogo. Em sistemas híbridos, cópias entre adaptadores e codificação/decodificação na GPU concorrida podem custar muito mais que no teste sintético.

Registrar adaptador, encoder/decoder efetivos e uso dos motores 3D/Video Encode/Video Decode/Copy. Comparar jogo limitado a FPS com jogo saturando a GPU. Não elevar prioridade global de processo como primeira solução.

## Telemetria que falta

Coletar por sessão, etapa e peer, com codec e perfil efetivos:

| Etapa | Métrica necessária |
| --- | --- |
| Worker | tempo WGC→encoder→RTP, FPS real, queue level/drop, erros e reinicializações |
| WebView recebendo a ponte | `ΔjitterBufferDelay / ΔjitterBufferEmittedCount`, `ΔtotalDecodeTime / ΔframesDecoded`, framesDropped, freezeCount, codec/decoder |
| WebView enviando | `ΔtotalEncodeTime / ΔframesEncoded`, `ΔtotalPacketSendDelay / ΔpacketsSent`, qualityLimitationReason/durations, framesEncoded/s, retransmissões, PLI/NACK |
| Rede até espectador | selectedCandidatePairId, tipo host/srflx/relay, RTT, availableOutgoingBitrate quando disponível, perda por intervalo |
| Espectador | jitter buffer, decode time, freezes/dropped frames e apresentação via requestVideoFrameCallback quando suportado |
| Medição visual | timestamp/frame-counter na fonte e câmera externa mostrando origem e destino simultaneamente |

Usar deltas, validar denominador e tratar reset de contadores e métricas indisponíveis. Não interpretar RTT/2 como latência visual. Não somar métricas potencialmente sobrepostas sem explicar seus limites. A aplicação atual registra FPS/RTT/bitrate, insuficientes para localizar o lag. [Definições W3C das estatísticas](https://www.w3.org/TR/webrtc-stats/).

## Sequência de otimização e comprovação

1. Instrumentar os três pontos WebRTC: recepção local, envio remoto e recepção do espectador. Incluir primeiro frame e identificação do build; preservar logs do worker.
2. Fazer A/B com mesma cena em movimento, fonte, 1080p60/H.264, bitrate efetivo e mesmo caminho de rede. Desligar replay em ambos; depois ligar apenas no host e apenas no espectador. Medir mediana/p95/p99 por cinco minutos após aquecimento.
3. Repetir com 720p60 aplicado realmente no worker; comparar com perfil alterado somente na saída. Isso isola desperdício de processamento.
4. Ajustar receiver da ponte e medir jitter efetivo. Testar áudio desligado/ligado para separar sincronização A/V. Alterar uma variável por execução.
5. Corrigir feedback de keyframes, startup e filas. Testar queda/reconexão, perda induzida, janela redimensionada, fonte encerrada e sessão de pelo menos 30 minutos.
6. Corrigir ABR por peer e medir um, dois e quatro espectadores. Não multiplicar contagens de encoders como se fossem necessariamente processos/sessões de hardware independentes: verificar implementação e uso real.
7. Comparar com protótipo de envio nativo direto. Se o atraso extra estiver majoritariamente na ponte/recodificação, esta é a solução de maior potencial; ajustes locais não eliminam essas etapas.

Critério de aceitação: reduzir latência visual medida no espectador sem piorar freezes, perda, qualidade ou sincronismo A/V, sob a mesma carga. Definir o orçamento desejado em conjunto com o produto, não declarar arbitrariamente que “zero buffer” ou “60 FPS” resolve o problema.

## Reprodução do teste sintético

Em PowerShell, usando o runtime já instalado; não captura conteúdo do usuário:

```powershell
$env:GST_TRACERS = 'latency(flags=pipeline+element)'
$env:GST_DEBUG = 'GST_TRACER:7'
$env:GST_DEBUG_NO_COLOR = '1'
$env:GST_DEBUG_FILE = Join-Path $PWD 'docs/latencia-sintetica-h264-1080p.log'
& native-media/gstreamer/bin/gst-launch-1.0.exe -q videotestsrc is-live=true num-buffers=120 pattern=ball '!' 'video/x-raw,format=BGRA,width=1920,height=1080,framerate=60/1' '!' d3d11upload '!' d3d11convert '!' 'video/x-raw(memory:D3D11Memory),format=NV12' '!' queue max-size-buffers=1 max-size-time=0 max-size-bytes=0 leaky=downstream '!' mfh264enc bitrate=8000 gop-size=60 low-latency=true rc-mode=cbr quality-vs-speed=0 ref=1 '!' 'video/x-h264,profile=constrained-baseline' '!' h264parse config-interval=1 '!' rtph264pay pt=96 config-interval=1 '!' fakesink sync=false async=false
```

O scanner inicial levou tempo adicional e emitiu avisos de dependências opcionais. Tempo total do processo não deve ser confundido com a latência de trânsito dos buffers medida no tracer.
