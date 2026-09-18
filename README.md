# 🎮 SeeMyGame

Plataforma de streaming P2P (*Peer-to-Peer*) em tempo real no navegador com foco em **máxima fluidez** e **baixa latência**.

Desenvolvido para transmitir jogos e telas entre navegadores usando WebRTC e sinalização via PeerJS. A mídia normalmente segue P2P, mas pode passar por TURN quando a rede não permite conexão direta.

---

## ⚡ Principais Recursos & Diretrizes Técnicas

- **Prioridade de Taxa de Quadros (Máxima Fluidez):** Configuração WebRTC com `degradationPreference = 'maintain-framerate'` e `contentHint = 'motion'`, instruindo o navegador e o codificador a priorizarem fluidez contínua mesmo sob pequenas variações de banda.
- **Preferência por H.264:** Priorização do codec H.264 via `setCodecPreferences` em transceivers de vídeo para permitir aceleração por hardware (NVENC, Intel QuickSync, AMD AMF) quando suportada pelo navegador e GPU do sistema.
- **Controle de Jitter Buffer & Latência:** Configuração de `jitterBufferTarget = 0` e `playoutDelayHint = 0` para modo ultra baixa latência, ou `0.05` para redes com oscilação moderada.
- **Áudio Estéreo Opus Gamer 128 kbps:** Injeção no SDP em conformidade com a RFC 8866 para áudio estéreo real em 48 kHz CBR (`stereo=1;sprop-stereo=1;maxaveragebitrate=128000;cbr=1`).
- **VU Meter Estéreo L / R com Liberação de Recursos:** Analisador visual de áudio Web Audio API (`AudioContext`, `ChannelSplitterNode`), com desconexão explícita de todos os nós ao encerrar o player para evitar vazamentos de memória.
- **Tuning Dinâmico e Restrições em Tempo Real:** Slider de bitrate (2.5 a 16 Mbps) e perfis (720p e 1080p fluidos) que atualizam ativamente as constraints da trilha (`applyConstraints`) e o encoder durante a transmissão.
- **Telemetria WebRTC Real (HUD):** Medição ao vivo de FPS, ping/latência RTT (ms) a partir do candidate-pair ativo/nomeado, bitrate consumido (Mbps), pacotes perdidos e resolução atual via `RTCPeerConnection.getStats()`.
- **Blindagem contra Injeção de HTML (XSS):** Validação estrita de Peer IDs (`^[a-zA-Z0-9_-]{1,64}$`) e manipulação de DOM através de APIs nativas seguras com `textContent`.
- **Gerenciamento Idempotente de Chamadas:** Prevenção de chamadas duplicadas por espectador, encerramento completo de conexões WebRTC ao parar a transmissão e máquina de estados para cancelamento de conexões pendentes.
- **Suporte a TURN Dinâmico via Serverless (/api/turn):** Resolução dinâmica de servidores TURN/STUN com cache/TTL e fallback configurável. A conectividade depende da configuração do endpoint, das credenciais e da rede; não é uma garantia de 100%.
- **Controle Remoto Co-op Player 2:** Espectadores podem solicitar autorização ao streamer. O teclado tem fallback para jogos web; mouse nativo depende das capacidades negociadas pelo Companion. Gamepad virtual nativo não está disponível neste build.
- **Botão de Pânico / Killswitch Instantâneo:** O streamer tem total controle com autorização explícita via modal e revogação imediata a qualquer momento ao pressionar a tecla `Escape` ou o botão de pânico na interface.
- **Agente Companion para Jogos de PC (tools/coop-agent.py):** Agente local em Python opcional para o streamer que injeta os comandos remotos do Player 2 diretamente em jogos nativos do Windows (Steam, emuladores, etc.).
- **Responsividade & Acessibilidade:** Grade fluida sem overflow em telas móveis, semântica ARIA para modais e leitores de tela, e integridade SRI no CDN do PeerJS.

---

## 🎮 Como Funciona o Co-op Player 2 & Agente PC

1. **Jogos Web / Emuladores no Navegador:** Funciona 100% nativo no navegador sem nenhum programa adicional instalado. O streamer clica em autorizar e o Player 2 já assume o controle!
2. **Jogos Nativos do Windows (Steam, RetroArch, etc.):**
   - O streamer inicia o Companion com um token exclusivo de pareamento:
     ```bash
     python tools/coop-agent.py --token SEU_TOKEN
     ```
   - A conexão só ocorre após autorização explícita da sessão e confirmação do token via WebSocket local (`ws://localhost:9876`). O agente anuncia teclado/mouse conforme as capacidades reais e não simula gamepad virtual.

---

## 📁 Arquitetura Modular & Páginas Dedicadas

```
SeeMyGame/
├── index.html            # Portal inicial: seleção de modo e roteamento inteligente
├── streamer.html         # Estúdio do Streamer: transmissão, presets de fluidez, áudio e telemetria
├── viewer.html           # Sala do Espectador: conexão por ID/link, reprodução fluida e Co-op
├── api/
│   └── turn.js           # Serverless Function: credenciais TURN dinâmicas (Vercel/Node)
├── tools/
│   └── coop-agent.py     # Agente Companion para injeção de inputs em jogos nativos do PC
├── css/
│   ├── main.css          # Variáveis de design, layout, responsividade mobile, modal acessível e toasts
│   └── player.css        # Grade fluida, cartões de vídeo, HUDs, overlays e estilo Player 2
├── js/
│   ├── config.js         # Servidores STUN/TURN, fetchIceServersFromApi, perfis de qualidade
│   ├── capture.js        # Provedores browser/native e máquina de estados de captura
│   ├── webrtc.js         # Motor WebRTC: SDP RFC 8866, preferência H.264, Jitter Buffer e FPS target
│   ├── coop.js           # Módulo Co-op: DataChannel, inputs P2, gamepad polling, killswitch
│   ├── audio.js          # Analisador estéreo Web Audio API, VU meter e ciclo de vida de nós
│   ├── stats.js          # Coletor de telemetria getStats (FPS, RTT ativo, bitrate, perda de pacotes)
│   ├── ui.js             # Manipulação segura do DOM (sem XSS), validação de IDs, modais Co-op
│   └── app.js            # Orquestrador central: PeerJS, captura autorizada e chamadas
└── README.md             # Documentação técnica e operacional
```

### Captura nativa no Windows

O app desktop enumera janelas e monitores com IDs opacos e valida a fonte no Rust antes de iniciar uma sessão. A seleção de uma janela/monitor não abre o seletor do WebView2; o fallback do navegador é uma ação separada.

O controle de fontes e sessões, o worker WGC/WASAPI e a ponte
GStreamer/WebRTC já estão implementados. O worker mantém vídeo no pipeline
nativo (H.264 ou HEVC/H.265) e áudio de loopback em Opus; o bridge
`webrtcbin` negocia SDP/ICE e entrega um `MediaStream` ao WebView sem passar
quadros pelo IPC. Prepare runtime e SDK com `npm run native:prepare` e valide
com `npm run native:smoke`. Ainda faltam os testes ponta a ponta em Windows
limpo, TURN, reconexão e múltiplos espectadores. O estado detalhado está em
[`docs/captura-nativa-implementacao.md`](docs/captura-nativa-implementacao.md).

### TURN em produção

Configure `METERED_DOMAIN`, `METERED_API_KEY` e `TURN_ACCESS_TOKEN` no ambiente da função `/api/turn`. O frontend pode receber o token de runtime por `window.__SEEMYGAME_TURN_ACCESS_TOKEN__` ou pelo armazenamento da sessão; ele não deve ser commitado no bundle. Sem autenticação/configuração válida, a API não entrega credenciais TURN e uma origem HTTPS usa somente STUN como fallback.

---

## 🚀 Como Executar Localmente

Como a aplicação é modular e utiliza ES Modules (`<script type="module">`), ela deve ser servida através de um servidor HTTP local simples:

### Opção 1: Usando Node / npx
```bash
npx serve .
```

### Opção 2: Usando Python
```bash
python -m http.server 8080
```
Acesse no navegador: `http://localhost:8080`

---

## 🧪 Testes Automatizados & Cobertura

Para executar a suíte de testes com o Vitest:
```bash
npm test
```

Para verificar o relatório de cobertura de código (v8):
```bash
npm run test:coverage
```

---

## 🌐 Como Compartilhar com Amigos

1. Acesse o **Estúdio do Streamer** (`streamer.html`) ou escolha "Quero Transmitir" na página inicial.
2. Configure a qualidade desejada (presets de fluidez e bitrate) e fonte de áudio.
3. Clique em **"Transmitir Jogo"** e selecione a janela ou tela desejada (lembre-se de marcar a opção de compartilhar áudio do sistema).
4. Clique no botão **"Copiar Link"** (que gera um link direto para a sala do espectador `viewer.html#watch=SEU_ID`).
5. Envie o link para seus amigos. Quando eles abrirem o link, serão direcionados para a página dedicada do espectador e a conexão iniciará automaticamente, sem botões confusos de transmissão!

