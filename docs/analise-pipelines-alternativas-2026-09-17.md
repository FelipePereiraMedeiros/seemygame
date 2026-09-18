# Pipelines nativo e web: diagnóstico e alternativas

Data: 17/09/2026. Análise do checkout atual, incluindo alterações locais, do E2E `2026-09-17T15-54-33-699Z-ce8b17` e de documentação primária. Não constitui benchmark de implementações alternativas. Nenhum caminho de produção foi alterado nesta análise.

## Parecer

A alternativa com melhor relação entre potencial de ganho e reaproveitamento é manter Tauri e o espectador web, mas transmitir diretamente do GStreamer ao espectador. O WebView2 deixaria de participar do caminho de mídia enviado. Primeiro comparar com o mesmo encoder Media Foundation; depois avaliar encoders específicos da GPU, prioridades e captura alternativa, separadamente.

A vantagem pretendida do nativo sob carga ainda precisa ser demonstrada. O projeto eleva a prioridade de CPU do processo Tauri, mas não implementa explicitamente prioridade de GPU nem prioridade do processo separado que executa captura e encode. Ser nativo não concede prioridade automática e não garante superar o Chromium.

## 1. Caminhos efetivamente implementados

### Vídeo nativo

```text
Janela/monitor
  → gst-launch: d3d11screencapturesrc, WGC, textura BGRA
  → d3d11convert: formato e resolução, NV12 para H.264/HEVC
  → queue: um buffer, descarta o mais antigo
  → mfh264enc / mfh265enc
  → parser + RTP → UDP localhost
  → GStreamer no Tauri: depay + pay → webrtcbin
  → WebRTC local → decode no WebView2 → MediaStreamTrack
  → chamada PeerJS → encode WebRTC de saída
  → ICE/P2P ou TURN → receptor → jitter/decode → apresentação
```

Evidências: `src-tauri/src/media.rs:706`, `src-tauri/src/webrtc_bridge.rs:87`, `js/native-webrtc.js:180`, `js/app.js:1460`.

A ponte Rust desempacota e reempacota RTP; não recodifica vídeo. A decodificação intermediária ocorre no WebView2. O código entrega as trilhas recebidas ao envio seguinte: não encontrei uma etapa `video.captureStream()` ou canvas nesse caminho. Diagramas anteriores que introduziam essa etapa devem ser corrigidos.

O ramo AV1 é diferente: `d3d11download → I420 em RAM → svtav1enc`. Portanto, AV1 atualmente adiciona download da GPU e encode por software. Não é uma alternativa automaticamente mais eficiente para jogar e transmitir.

### Vídeo web

```text
Janela/monitor escolhido pelo usuário
  → getDisplayMedia → MediaStreamTrack
  → chamada PeerJS → encode WebRTC do navegador
  → ICE/P2P ou TURN → receptor → jitter/decode → apresentação
```

O backend de captura, o encoder e eventuais cópias internas dependem do navegador, sistema e driver. O código não prova que o Chromium utilizou WGC, zero-copy ou encode por hardware naquela execução. Não tratar essas hipóteses como fatos do benchmark.

### Áudio, replay e múltiplos espectadores

- Nativo: WASAPI loopback, inclusive árvore do processo quando suportada, conversão/resample para 48 kHz estéreo, Opus e RTP. O áudio também atravessa a ponte e o WebRTC de saída. Medir latência sonora, descontinuidades e sincronismo A/V; otimizar apenas vídeo pode criar dessincronização.
- Web: captura de áudio depende da superfície e do suporte do navegador; há fallback para vídeo sem áudio. Comparar execuções com a mesma política de áudio.
- Replay: `js/app.js:1926` inicia gravação local salvo opção contrária; `:1565` inicia gravação remota. Desabilitar apenas replay local não isola o teste. MediaRecorder pode adicionar encode e competir por recursos nos dois computadores. A preferência inicial de codec do gravador é VP9.
- Distribuição: PeerJS abre chamadas por espectador. Medir custo por conexão e por encoder; não presumir compartilhamento de encode entre chamadas.

## 2. Problemas e oportunidades verificáveis

| Ponto | Evidência | Consequência / ação |
|---|---|---|
| Prioridade incompleta | `system.rs:1–20` usa `SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS)`; comentário em `app.js:2116` fala em GPU | Corrigir a descrição e medir prioridades reais por PID/thread. CPU HIGH do Tauri não equivale a GPU prioritária. |
| Worker sem prioridade explícita | `media.rs:580` configura ambiente e `CREATE_NO_WINDOW` | Definir política no worker de mídia, após medir. Não presumir herança de HIGH. |
| Duas gerações de compressão | Encode nativo, decode local, encode WebRTC remoto | Envio direto remove trabalho, filas e perda de qualidade por recodificação. Ganho em milissegundos ainda desconhecido. |
| AV1 por software | `d3d11download` + `svtav1enc` | Evitar escolha automática sob jogos; só habilitar por capacidade e orçamento medidos. |
| Adaptação olha a rede | `js/abr.js:137` usa perda/RTT; `js/stats.js` já coleta motivo de limitação e encode | Rede boa pode coexistir com CPU/GPU saturada. Acrescentar adaptação de resolução/FPS/replay com histerese e sem disputar controle com GCC. |
| Perfil web pede 60 FPS fixos | `js/app.js:1858` | Usar o FPS solicitado pelo perfil e registrar `getSettings()` e FPS efetivo. Evitar captura maior que o envio pretendido. |
| Logging nativo verboso | `GST_DEBUG=*:3,d3d11*:5,webrtc*:4` por padrão | Comparar logging de produção com diagnóstico; medir I/O e CPU. Custo ainda não quantificado. |
| Adaptador não selecionado explicitamente | Pipeline não fixa GPU/LUID | Registrar GPU de captura, conversão, encode e decode; investigar cópias entre iGPU/dGPU. |
| Startup desacoplado | Worker começa antes da negociação completa da ponte | Instrumentar primeiro frame/IDR e ordem de ativação. Hipótese de espera no início, não explicação comprovada da cauda. |
| Controle atravessa fronteira UDP | Worker e ponte são pipelines separados | Não encontrei canal de retorno ao encoder do worker para pedidos de keyframe/bitrate. Verificar propagação efetiva de PLI e controle antes de reutilizar a ponte para Internet. |

A fila anterior ao encoder já está limitada a um buffer. Isso não limita filas internas do encoder, sockets, decoder ou navegador. Adicionar mais `queue` indiscriminadamente pode piorar o resultado.

### O que prioridade pode e não pode fazer

`SetPriorityClass` atua no escalonamento de CPU. A criação de processo sem classe explícita normalmente usa NORMAL; HIGH do pai não implica HIGH do filho. Confirmar em execução com `GetPriorityClass`. Fontes: [SetPriorityClass](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setpriorityclass), [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw).

Para CPU, avaliar MMCSS nas threads de mídia. Para GPU, estudar `IDXGIDevice::SetGPUThreadPriority` no dispositivo usado pelo pipeline, com prioridade relativa moderada. Criar outro dispositivo no Tauri e alterá-lo não prioriza automaticamente o dispositivo do worker. O efeito depende do escalonador/driver e precisa ser medido junto ao desempenho do jogo. Fontes: [MMCSS](https://learn.microsoft.com/en-us/windows/win32/procthread/multimedia-class-scheduler-service), [DXGI GPU priority](https://learn.microsoft.com/en-us/windows/win32/api/dxgi/nf-dxgi-idxgidevice-setgputhreadpriority).

Não propor REALTIME, prioridade absoluta máxima ou alterações de registro como padrão. A própria documentação de MMCSS informa que o campo de registro “GPU Priority” não é utilizado. Prioridade não cria capacidade: limitar FPS do jogo para deixar margem deve fazer parte do comparativo. A [orientação de desempenho do OBS](https://obsproject.com/kb/encoding-performance-troubleshooting) também trata dessa disputa por GPU.

## 3. Alternativas pesquisadas

### A. GStreamer direto para o navegador — primeira escolha

```text
WGC → textura/conversão GPU → H.264 → WebRTC remoto → navegador
WASAPI → Opus ────────────────────────────────┘
```

Manter Tauri como interface e supervisor. Um worker Rust dedicado deve possuir captura, encoder e transporte, preservando isolamento de falhas e permitindo controlar dispositivo, threads, bitrate e keyframes. Remover a ponte WebView2 do caminho de envio. Preview deve ser opcional e medido separadamente.

Há duas implementações candidatas:

- **webrtcsink:** protótipo rápido, com sinalização customizável, controle de congestionamento e recuperação de perdas. Não é substituição transparente do protocolo PeerJS. Também não significa encode compartilhado: a documentação descreve pipelines/encoders por consumidor.
- **webrtcbin:** mais controle sobre encoder, RTP, feedback e integração atual; exige implementar e validar esses controles. “Conecta e mostra vídeo” é insuficiente para produção na Internet.

Fontes: [rswebrtc e diferenças entre os elementos](https://gstreamer.freedesktop.org/documentation/rswebrtc/index.html), [webrtcsink](https://gstreamer.freedesktop.org/documentation/rswebrtc/webrtcsink.html).

Integração precisa preservar autenticação/sala/PIN, autorização para mídia, ICE/TURN, reconexão, encerramento, áudio e compatibilidade dos espectadores. Não basta trocar o destino do UDP para um IP remoto.

### B. Encoders específicos de GPU — segunda variável experimental

Comparar Media Foundation atual com:

| GPU | Elemento candidato | Interesse |
|---|---|---|
| NVIDIA | `nvd3d11h264enc` | Aceita D3D11Memory; controle explícito do encode e do adaptador. |
| Intel | `qsvh264enc` | Quick Sync, inclusive entrada D3D11Memory nas configurações suportadas. |
| AMD | `amfh264enc` | Controle por AMF para hardware compatível. |

Fontes: [NVIDIA](https://gstreamer.freedesktop.org/documentation/nvcodec/nvd3d11h264enc.html), [Intel](https://gstreamer.freedesktop.org/documentation/qsv/qsvh264enc.html), [AMD](https://gstreamer.freedesktop.org/documentation/amfcodec/amfh264enc.html).

Media Foundation pode já usar o mesmo hardware; trocar API não garante aceleração. Comparar preset, B-frames/lookahead, qualidade e bitrate equivalentes. Testar conversão BGRA→NV12 explícita versus entrada aceita pelo encoder, sem assumir que remover um elemento elimina a conversão interna. Manter H.264 como primeiro experimento; HEVC/AV1 dependem da matriz de encode/decode/negociação de cada participante.

Inspeção do runtime empacotado GStreamer 1.28.7: `mfh264enc`, `nvd3d11h264enc`, `webrtcsink` e `webrtcbin` foram reconhecidos. `qsvh264enc`, `amfh264enc` e `nvav1enc` não foram reconhecidos no ambiente inspecionado. Houve avisos de plugin loader e de dependência `giolibproxy.dll`; portanto, isso não prova ausência de suporte em todos os computadores. Factory disponível também não prova encode funcional ou melhor desempenho. A inspeção usou registro isolado em `output/gst-research-registry.bin`.

### C. WGC versus Desktop Duplication

Manter WGC para janela. Para monitor, comparar `capture-api=dxgi` com WGC, com mesma GPU, resolução e encoder. A API alternativa não substitui a semântica de captura isolada de janela. Fonte: [d3d11screencapturesrc](https://gstreamer.freedesktop.org/documentation/d3d11/d3d11screencapturesrc.html).

Não introduzir injeção no processo do jogo como primeira solução. WGC/DXGI permitem investigar desempenho sem essa mudança. Compatibilidade com anticheat continua exigindo validação por jogo; não há garantia universal.

### D. Melhorias no web sem substituir a arquitetura

1. Capturar no perfil efetivo e adaptar resolução antes de sacrificar toda a cadência, conforme preferência do usuário.
2. Desabilitar replay local/remoto em medição isolada e oferecer política de suspensão sob carga no produto.
3. Usar `qualityLimitationReason`, tempo de encode, FPS e pausas para distinguir gargalo de recursos de congestionamento de rede.
4. Comparar codecs realmente negociados, não apenas preferidos; registrar encoder implementation quando disponível.
5. Manter preview, overlays e leitura de pixels fora do caminho crítico quando possível.
6. Medir políticas de jitter com áudio e rede real. `jitterBufferTarget=0` é uma solicitação, não garantia de buffer nulo; o projeto já aplica esse ajuste no modo de baixa latência.

`priority`/`networkPriority` do sender não são prioridade de CPU/GPU do Windows. O navegador continua responsável pelo pipeline interno. Métricas e controle devem respeitar a semântica de [WebRTC Stats](https://www.w3.org/TR/webrtc-stats/).

### E. Replay sem nova compressão no nativo

Um buffer circular dos pacotes/frames já codificados pode substituir o MediaRecorder local. Armazenar GOPs decodificáveis, timestamps e áudio, com limites de memória e duração. A exportação pode remuxar em vez de recodificar. Trata-se de trabalho adicional de implementação; não presumir que basta gravar datagramas RTP em MP4.

### F. Outras substituições

| Alternativa | Quando considerar | Limite |
|---|---|---|
| libwebrtc nativa | Necessidade de controle profundo do stack WebRTC | Build e integração C++/Rust relevantes; captura e hardware encode continuam exigindo integração. |
| libdatachannel / webrtc-rs | Controle de transporte ou restrições específicas | Não são substitutos completos de captura, encoder e adaptação. Validar pacing, congestionamento, feedback e sincronismo. |
| SFU, como mediasoup | Vários espectadores e limite de upload/encode por conexão | Pode reduzir fan-out do host; adiciona servidor e caminho de rede. Não é promessa de menor latência para um espectador. |
| Sunshine/Moonlight | Referência de streaming de jogos; opção de receptor nativo | Altera requisitos do produto; não substitui diretamente o espectador web. |
| WebCodecs + transporte próprio | Necessidades que WebRTC não atenda | API de codec não fornece, sozinha, transporte, congestionamento, áudio e sincronização completos. Alto custo para primeira otimização. |

Fontes: [WebRTC nativo](https://webrtc.github.io/webrtc-org/native-code/development/), [libdatachannel](https://github.com/paullouisageneau/libdatachannel), [webrtc-rs](https://github.com/webrtc-rs/webrtc), [mediasoup](https://mediasoup.org/documentation/overview/), [Sunshine](https://docs.lizardbyte.dev/projects/sunshine/latest/), [WebCodecs](https://www.w3.org/TR/webcodecs/).

## 4. Como comprovar ganho

O relatório de 15:54 aponta native/web p50 de 100/65 ms e p99 de 254/84 ms, com aproximadamente 58,6/54,5 FPS medianos. Não basta para selecionar uma nova arquitetura:

- Execução curta, binário debug e apenas oito intervalos steady no resumo.
- Percentis ópticos agregam a execução, enquanto o FPS destacado usa steady. Startup e regime precisam ter distribuições separadas.
- O comparativo inverte host/receptor entre WebView2 e Chrome. Fixar receptor e criar também controle web no mesmo host quando possível.
- Leitura óptica ainda custa cerca de 14–15 ms na mediana por amostra. Comparar instrumentação desligada, leve e óptica; 8 Hz não permite observar todos os eventos de um stream de 60 FPS.
- O marcador mede idade da imagem por software. `expectedDisplayTime` não é medição física do instante de iluminação do painel. Usar câmera externa de alta velocidade para validar uma amostra da metodologia.

### Matriz incremental

Primeiro: web atual, nativo atual e nativo direto com o mesmo encoder. Depois variar encoder; depois políticas de prioridade. Não mudar tudo na mesma rodada.

Para cada variante, testar:

1. Sem carga e sem replay, depois replay local/remoto e áudio habilitados.
2. Jogo com GPU 3D saturada, jogo limitado em FPS e carga de CPU separada; incluir saturação combinada.
3. Jogo em primeiro plano e host em segundo plano; mesma cena/replay determinístico.
4. Um receptor em outra máquina para separar custo do espectador do host. Manter também cenário de uma máquina para diagnóstico.
5. LAN, P2P e TURN com condições registradas; teste controlado de perda/jitter após baseline local.
6. Um, dois e quatro espectadores para identificar custo de fan-out.

Usar release, aquecimento separado, pelo menos cinco repetições de 60 segundos em ordem alternada/randomizada. Aumentar duração para quantis extremos e sessões longas. Registrar temperaturas, clocks, driver, HAGS, energia, GPU/LUID e processos; manter essas condições fixas antes de testá-las como fatores.

### Métricas que decidem

- **Espectador:** latência steady p50/p95/p99; frames distintos apresentados; freezes e tempo congelado; qualidade visual; A/V sync.
- **Jogo:** frame time p50/p95/p99 e 1% low, comparados com jogo sem transmissão. Melhor streaming às custas de travar o jogo não atende ao objetivo.
- **Pipeline:** timestamps e contadores por etapa, espera versus processamento, ocupação de filas, descarte, encode/decode, jitter, RTT, perdas/RTX/PLI e bitrate efetivo.
- **Recursos:** CPU por processo/thread, tempo de espera de CPU, GPU por engine (3D/copy/video encode/video decode), VRAM e RAM. “GPU 99%” isolado não localiza o gargalo.
- **Priorização:** classe real de cada processo, cadastro MMCSS, dispositivo afetado, retorno das APIs. Flag habilitada sem efeito comprovado não conta como resultado.
- **Robustez:** primeiro frame, reconnect, resize/minimização, encerramento do jogo, mudança de monitor e retomada após sobrecarga.

Instrumentar etapas com um relógio monotônico e IDs quando disponíveis. Para hosts distintos, calibrar offset e erro dos relógios; não subtrair timestamps de máquinas sem sincronização validada. Tratar sobrecarga dos probes como variável. Não somar médias de componentes para explicar diferença entre medianas fim a fim.

Critério de escolha: melhora repetível de cauda de latência e frames apresentados sob carga, com qualidade equivalente e regressão do jogo dentro de um limite previamente definido. Reportar dispersão entre execuções; não tratar centenas de frames correlacionados como centenas de experimentos independentes.

## 5. Ordem recomendada

1. Corrigir a informação sobre prioridade, alinhar o comparativo e medir carga real. Controlar replay, logging e perfis.
2. Prototipar envio GStreamer direto com H.264/Media Foundation, um espectador e fallback atual preservado.
3. Comparar NVIDIA D3D11 no hardware disponível, mantendo as demais condições.
4. Aplicar e medir prioridade no worker/dispositivo correto; avaliar WGC/DXGI para monitor e política de margem de GPU.
5. Completar áudio, feedback, reconexão, autenticação e replay codificado antes de promover o protótipo.
6. Considerar SFU se a multiplicação de espectadores demonstrar gargalo.

Não há evidência para prometer 40–50 ms, nem garantia de vitória do nativo em todos os cenários. Existe uma oportunidade concreta de remover trabalho redundante e controlar melhor recursos. O próximo benchmark deve comprovar se isso produz a estabilidade durante jogos que motivou o desenvolvimento nativo.
