# Plano de implementação: captura nativa no Windows

Data: 14/09/2026. Status: implementação principal aplicada; o controle de
fontes/sessões, a integração do seletor, o worker WGC/WASAPI com H.264/HEVC e
a ponte WebRTC/SDP/ICE foram aplicados. Restam validações ponta a ponta em
Windows limpo e a expansão para os cenários remotos previstos.

## Resultado esperado

No aplicativo Windows, o usuário escolhe uma janela ou um monitor no seletor do SeeMyGame e inicia a transmissão diretamente. A janela escolhida deve ser a efetivamente capturada, sem abrir o seletor do WebView2. Compartilhamento pelo site continua usando o consentimento e o seletor do navegador.

“Tela inteira” deve identificar um monitor. Selecionar um processo deve identificar também a janela a transmitir quando houver várias; áudio pode abranger a árvore do processo. Esses conceitos não devem ser tratados como equivalentes.

## Diagnóstico que orienta a mudança

Em `js/app.js`, os botões do seletor desktop chamam `startLocalStream()` sem encaminhar a identidade da fonte. Essa função usa `getDisplayMedia()`. O Rust enumera janelas, mas ainda não captura quadros. Portanto, esconder o modal ou passar apenas o título da janela não resolve o problema.

Há uma segunda dependência: o envio atual usa `peer.call(..., localStream)`. Quadros capturados em Rust não se tornam automaticamente um `MediaStream` no WebView. Preview, estado de transmissão e gravação também dependem desse objeto e precisarão de adaptação.

## Arquitetura recomendada

```text
Seletor SeeMyGame → comando Tauri com sourceId validado
                           ↓
                 Windows Graphics Capture
                           ↓
                   textura GPU / D3D11
                           ↓
                     encoder H.264 ─────┐
                                       ├→ WebRTC nativo → navegador do espectador
                   WASAPI → Opus ───────┘

Interface JS ↔ comandos/eventos Tauri: controle, estado, SDP, ICE e métricas
```

Usar Windows Graphics Capture (WGC) para janela/monitor e WASAPI para áudio. A Microsoft oferece captura direcionada por [HWND](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow) e [HMONITOR](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createformonitor), disponível a partir do Windows 10 1903. Verificar suporte em execução.

Adotar **GStreamer como candidato principal do protótipo**, integrado ao Rust em um worker de mídia. Ele já oferece [captura WGC/D3D11 por identificador de janela ou monitor](https://gstreamer.freedesktop.org/documentation/d3d11/d3d11screencapturesrc.html), [encoder H.264 via Media Foundation com entrada D3D11](https://gstreamer.freedesktop.org/documentation/mediafoundation/mfh264enc.html) e [WebRTC com SDP/ICE](https://gstreamer.freedesktop.org/documentation/webrtc/index.html). Fixar a versão e os plugins após validar hardware, distribuição e licenças. A documentação não garante ausência de cópias em toda combinação de GPU/driver; isso será medido.

Os frames de produção devem permanecer no pipeline nativo. IPC Tauri transporta mensagens de controle, sem vídeo bruto em JSON/Base64. Não criar servidor HTTP local para essa integração.

O espectador recebe a transmissão nativa por `RTCPeerConnection`, mantendo o componente de vídeo existente. Os canais de dados atuais podem transportar sinalização direcionada após corrigir autenticação. Esse protocolo será próprio e versionado; não pressupõe compatibilidade automática com `MediaConnection` do PeerJS. Chamadas originadas no navegador continuam no caminho atual.

## Etapas e critérios de conclusão

### 1. Protótipo de viabilidade

- Capturar uma janela e um monitor por identificador real, sem seletor adicional.
- Enviar H.264 a um navegador em outro computador, inicialmente com uma conexão e perfil 720p60; experimentar 1080p60 após estabelecer a medição.
- Validar codec negociado, aceleração real, uso de CPU/GPU, frames perdidos, latência e conexão por TURN.
- Confirmar compilação com o toolchain do projeto e execução com runtime empacotado, sem depender de GStreamer instalado globalmente.
- Registrar versões, plugins, tamanho do pacote e limitações encontradas.

**Saída:** prova funcional ponta a ponta e decisão documentada sobre o backend. Se aceleração, interoperabilidade ou distribuição falharem, revisar o backend antes de expandir a integração.

### 2. Contratos, fontes e autorização

- Criar uma interface de captura com provedores `browser` e `native`, expondo iniciar, parar, estado e capacidades. O estado ativo não pode depender apenas de `localStream`.
- Enumerar janelas e monitores com nome, dimensões, DPI e identificação de monitor. Manter HWND/HMONITOR em um registro Rust; retornar `sourceId` opaco à UI.
- Revalidar a fonte e a identidade do processo no início; invalidar IDs antigos e tratar reutilização de handles. O frontend não deve enviar um handle arbitrário para captura.
- Implementar estados `idle`, `starting`, `live`, `stopping` e `error`, com início/encerramento idempotentes e um identificador por sessão.
- Antes de conectar espectadores ao backend nativo, revalidar os achados da auditoria contra as alterações mais recentes e corrigir os que permanecerem: membros/mídia antes do PIN, sinalização de remetentes não autorizados, retransmissão em ciclo e XSS. Restringir os comandos nativos à interface local autorizada.

**Saída:** testes demonstram que a seleção chega ao backend e participantes rejeitados não negociam nem recebem mídia.

### 3. Integração do seletor e ciclo de captura

- Encaminhar `sourceId` ao comando nativo nos botões de janela e monitor. Oferecer escolha explícita quando um processo tiver várias janelas.
- Mostrar fonte ativa e botão de parar acessível. Não iniciar captura automaticamente ao abrir o aplicativo.
- Tratar fechamento, redimensionamento, minimização, troca de resolução/DPI, monitor desconectado, bloqueio da sessão e perda de dispositivo GPU.
- Se a fonte desaparecer, interromper ou apresentar recuperação explícita. Nunca ampliar silenciosamente uma captura de janela para o monitor.
- Começar com saída SDR e validar HDR/conversão antes de declarar suporte. Expor indisponibilidade de captura protegida sem tentar contorná-la.
- Remover a chamada a `getDisplayMedia()` do caminho nativo; fallback para o navegador somente por ação explícita do usuário.

**Saída:** iniciar uma transmissão desktop captura exclusivamente a fonte escolhida e não abre o diálogo mostrado na imagem.

### 4. Áudio e sincronização

- Disponibilizar modos: sem áudio, áudio do processo e áudio do sistema. Manter microfone/chat de voz com controles independentes.
- Associar o áudio do jogo ao PID validado e definir inclusão dos processos filhos.
- O [loopback por processo exige build 20348 ou superior](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/). Priorizar Windows 11; em sistemas sem essa capacidade, indicar a limitação e oferecer áudio do sistema como escolha explícita.
- O [wasapi2src oferece modos de inclusão/exclusão da árvore do processo](https://gstreamer.freedesktop.org/documentation/wasapi2/wasapi2src.html). Validar cada modo e evitar que reprodução de voz/preview seja recapturada como eco.
- Sincronizar relógios de áudio/vídeo; normalizar áudio para Opus, tratar silêncio e troca/desconexão de dispositivo.

**Saída:** o modo “áudio do jogo” não transmite áudio de outro aplicativo; áudio e vídeo permanecem sincronizados durante teste prolongado.

### 5. Sessões WebRTC e recursos existentes

- Definir mensagens direcionadas de oferta, resposta, ICE e encerramento com versão, sessão, stream e destinatário. Validar remetente, tamanho e estado esperado; ignorar mensagens de sessões encerradas.
- Reutilizar configuração STUN/TURN com obtenção prévia das credenciais e tratamento de validade. Destruir conexões quando o membro sair, perder autorização ou a captura parar.
- Manter uma conexão por espectador. No primeiro marco, usar um perfil fixo e medir o custo por destinatário; só então decidir compartilhamento do encoder ou encoders independentes. ABR não pode alterar globalmente todos os espectadores sem uma política explícita.
- Implementar preview local inicialmente como recepção WebRTC local, com áudio silenciado e custo de decodificação medido. Não retransmitir esse preview para os espectadores.
- Preservar voz, chat e controles de qualidade. Adaptar facecam/composição explicitamente se dependem da antiga stream.
- Para clipes do host, criar buffer de segmentos codificados com keyframes e mux válido. O gravador do espectador pode continuar recebendo `MediaStream`, após corrigir os problemas de segmentação apontados na auditoria.

**Saída:** transmissão nativa integra a sala sem quebrar o compartilhamento pelo navegador; recursos ainda indisponíveis ficam claramente indicados durante a implantação.

### 6. Empacotamento, validação e liberação

- Empacotar apenas runtime/plugins necessários, com versões fixadas, inventário de dependências e avisos de licença. Validar em Windows limpo e verificar requisitos do runtime MSVC.
- Corrigir o build que hoje encerra `seemygame.exe` indiscriminadamente antes de usar builds repetidos nessa validação.
- Cobrir Windows/GPU suportados, NVIDIA/AMD/Intel conforme disponíveis, múltiplos monitores, DPI diferente, janela e jogo em tela cheia; documentar fullscreen exclusivo por jogo.
- Testar LAN, internet e TURN, reconexão, múltiplos espectadores, cancelamento durante início e pelo menos 20 ciclos de iniciar/parar.
- Fazer sessões de pelo menos 30 minutos para medir memória, frames, sincronização e encerramento de recursos. Estabelecer os limites de CPU/GPU/latência a partir do protótipo e de máquinas de referência identificadas.
- Automatizar a prova de que o provedor nativo não chama `getDisplayMedia`; confirmar manualmente ausência do seletor e correspondência da fonte capturada.
- Validar cenários com jogos/anticheats suportados antes de anunciar compatibilidade. WGC usa a API do sistema e evita injeção/hook no jogo; isso é uma escolha de menor interferência, não uma certificação de compatibilidade com Vanguard.

**Saída:** pacote reproduzível, relatório de testes e ativação controlada do modo nativo, com o modo navegador ainda disponível.

## Organização proposta do código

Estes caminhos são propostas, não arquivos já implementados:

| Área | Local proposto | Responsabilidade |
|---|---|---|
| Fontes e sessões | `src-tauri/src/capture/` | Registro de fontes, validação, estado, comandos |
| Engine de mídia | `src-tauri/src/media/` | Pipeline GStreamer, áudio, WebRTC, métricas e clipes |
| Ponte desktop | `js/desktop.js` | Comandos/eventos tipados por contrato |
| Abstração de captura | `js/capture.js` | Provedores navegador/nativo |
| Recepção nativa | `js/native-webrtc.js` | SDP/ICE e streams recebidas |
| Sala e interface | `js/app.js`, `js/room.js`, `js/ui.js` | Autorização, seleção, estado e apresentação |
| Verificação | `tests/` e testes Rust | Contratos, permissões, ciclo de vida e regressões |

## Ordem de entrega

1. Protótipo isolado: janela/monitor → vídeo no navegador remoto.
2. Integração autorizada na sala: fonte correta, parar, TURN e encerramento confiável.
3. Áudio do processo/sistema e preview.
4. Múltiplos espectadores, adaptação de qualidade, clipes e composição.
5. Pacote validado e liberação.

O primeiro incremento utilizável é captura de uma janela ou monitor para um espectador, sem o diálogo do WebView2. A implementação completa inclui os recursos que hoje dependem de `localStream`; concluir apenas a enumeração ou o preview local não atende ao objetivo.
