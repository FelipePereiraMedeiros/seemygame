# Sétimo parecer — sair da comparação de médias e localizar o defeito

Análise em 19/09/2026 da rodada `output/isolation-battery/2026-09-18T21-48-25-405Z/isolation-report.json` (18/09, 18:48–18:56 de Brasília), código `5b842ec`. Não foram feitas alterações de produção nem nova transmissão nesta revisão.

## O que mudou no diagnóstico

Baseline steady e teardown avançaram, mas o binário continua com o mesmo SHA256 iniciado em 373f91ca. As rodadas recentes alteraram principalmente o instrumento. Ainda faltam intervenções controladas no caminho de mídia, capazes de confirmar ou excluir causas.

Agora há falhas reais durante steady. Vídeo puro: 41,1/48,3 FPS, pausas máximas de 1.963/989 ms. Controle A/V: 39,5/21,3 FPS e pausas de 1.461/10.364 ms. Prévia suspensa: 38,2/49,6 FPS. Portanto, não há base para explicar tudo por áudio ou por prévia. A fonte continua perto de 60 FPS, com intervalos máximos de desenho de aproximadamente 18,4–18,6 ms.

## Três padrões diferentes, que precisam de investigações separadas

### 1. Frames chegam, mas não são decodificados

No vídeo puro, repetição 1, segundo 8: 61 frames recebidos, zero decodificados e cinco novos PLIs. No segundo seguinte há 61 recebidos, 23 decodificados, mais três PLIs e gap de apresentação de 1.963 ms. Isso enfraquece falta de produção/capacidade de rede como explicação desse episódio. Priorizar integridade H.264, referências/keyframes, timestamps e funcionamento do decoder. PLI e chegada de frames não provam isoladamente qual desses componentes falhou.

### 2. Frames deixam de chegar ao receptor

No controle, repetição 2, segundos 10–19: delta de framesReceived fica zero, enquanto a fonte continua desenhando e o áudio progride. O vídeo retorna no segundo 20. Aqui é necessário observar se pararam pacotes, montagem de frames ou envio no host. Não é o mesmo padrão do episódio anterior; apenas atribuir tudo ao decoder perderia essa diferença.

### 3. Áudio chega, mas é descartado/substituído

Em aproximadamente 20 s, os cenários A/V registram cerca de 1.015–1.017 pacotes de áudio recebidos, 335–351 descartados, zero perdidos e 33,69–34,89% de concealed samples. A repetição é mais estável que a variação do FPS. Priorizar prazos de reprodução, sequência/relógio RTP e timestamping, sem confundir descarte com perda de rede.

## Candidatos no código

**Prioridade alta: ponte UDP/RTP e reconstrução de tempo.** Em `src-tauri/src/webrtc_bridge.rs`, áudio segue `udpsrc → rtpopusdepay → rtpopuspay → queue → webrtcbin`. A entrada de vídeo também desempacota e reempacota. Não há rtpjitterbuffer explícito antes desses depayloaders. É uma fronteira concreta para medir alterações no relógio e na integridade do fluxo, não uma conclusão de defeito comprovado.

A documentação do [udpsrc](https://gstreamer.freedesktop.org/documentation/udp/udpsrc.html) explica que os buffers recebem timestamps do running time local. O [rtpjitterbuffer](https://gstreamer.freedesktop.org/documentation/rtpmanager/rtpjitterbuffer.html) reconstrói PTS usando o tempo RTP e DTS/PTS de entrada. Logo, medir RTP/PTS antes e depois da ponte é mais informativo que continuar ajustando apenas jitterBufferTarget no espectador. Adicionar esse elemento às cegas também pode acrescentar atraso; primeiro verificar o que a cadeia atual efetivamente produz.

**Prioridade alta: decode/integridade e recuperação de H.264.** Os episódios com recebimento ativo, decode zero e PLI crescente pedem logs de decoder, flags de descontinuidade, SPS/PPS/IDR e encaminhamento de solicitação de keyframe ao encoder. Não concluir que uma GPU lenta seja a causa só pela média alta de totalDecodeTime.

**Prioridade média: timestamps da captura de áudio.** O worker usa `wasapi2src low-latency=true do-timestamp=true`, seguido de Opus com `perfect-timestamp=false hard-resync=true`, e UDP `sync=false`. Vale testar separadamente origem dos timestamps e ressincronização, confrontando duração real dos pacotes Opus com avanço de RTP. Não trocar todas as propriedades de uma vez nem introduzir audiorate sem medir descontinuidades.

**Prioridade média: pressão de recursos e filas compartilhadas.** Fonte, host, prévia e receptor coexistem na mesma máquina; não há captura suficiente de atividade por engine da GPU e filas para responsabilizar NVENC, D3D11 ou CPU. A prévia pode contribuir, mas o resultado varia e vídeo puro também trava.

## Como avançar com menos rodadas

1. **Uma sessão limpa, vídeo puro, até capturar um engasgo.** Registrar ring buffer de 5 s antes/depois do evento, com contadores e relógios monotônicos em quatro pontos: saída do encoder, entrada UDP da ponte, saída RTP da ponte e receptor. No receptor: pacotes, framesReceived/Decoded/Dropped, PLI/NACK e gaps. No host: tamanho das filas, PTS/DTS/duration, DISCONT, keyframe e estado do pipeline. Fazer agregação por intervalo e guardar amostras detalhadas somente perto do evento para reduzir overhead.
2. **Áudio sozinho, sem captura de vídeo nem prévia.** Medir descartes/concealment. Se persistirem, o defeito não depende da carga de vídeo ou sincronização com vídeo. Comparar WASAPI com audiotestsrc mantendo o restante da cadeia. Se a fonte sintética também falhar, concentrar a investigação em Opus/transporte/ponte/receptor.
3. **Experimento A/B na ponte.** Após inspecionar os timestamps, comparar a cadeia atual com reconstrução de PTS ou encaminhamento RTP preservando os timestamps, cuidando de payload negociado, SSRC e requisitos WebRTC. Só atribuir causalidade se a intervenção corrigir o sinal e a reversão trouxer o problema novamente.
4. **Isolar receptor.** Reproduzir o mesmo fluxo em outro processo/máquina ou decoder GStreamer para distinguir bitstream/tempo incorreto de problema específico do Chromium/driver. Reduzir resolução ou FPS apenas como teste de pressão; melhora sob carga menor não localiza a causa sozinha.
5. **Validar a correção, então ampliar a bateria.** Confirmada a causa, testar A/V real, áudio audível em endpoint isolado, 1080p60 e carga de jogo, incluindo latência óptica. A bateria completa deve validar a correção, não substituir os experimentos locais.

## Pendência do harness que atrapalha os timeouts

As três variantes de jitter continuam falhando antes de reproduzir vídeo. Os diagnósticos mostram host idle e sem stream, mas foram capturados no catch externo DEPOIS do finally executar stopNativeCapture. Essa fotografia mostra o estado limpo, não o estado no instante do erro. Coletar diagnóstico antes do teardown, preservar primeiro erro e não misturar timeout de startup com stutter de transmissão.

Também há perda de informação em `computeSteadyQuality`: contadores ausentes/baseline ausente podem virar zero, e regressões de contador são achatadas para zero. Para diagnóstico, separar ausência, reset e delta válido; não permitir que falta de observação pareça saúde.

## Critério para a próxima entrega

Não apenas uma nova tabela de FPS. A entrega deve identificar: em qual fronteira o fluxo deixa de progredir ou muda de timestamp; qual intervenção altera esse comportamento; e se a reversão reproduz o defeito. O candidato mais concreto para áudio é cadência/timestamps na passagem worker–ponte–receptor. Para vídeo existem pelo menos dois mecanismos a localizar: decode sem progresso apesar de frames recebidos e interrupção na chegada de frames.
