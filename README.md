# 🎮 SeeMyGame

Plataforma de streaming P2P (*Peer-to-Peer*) em tempo real no navegador com foco em **trava de 60 FPS** e **latência ultra-baixa** (*Zero Lag*).

Desenvolvido para transmitir jogos e telas diretamente entre navegadores usando WebRTC e sinalização via PeerJS, sem necessidade de servidores de mídia intermediários.

---

## ⚡ Principais Recursos

- **Trava Estrita de 60 FPS:** Configuração WebRTC com `degradationPreference = 'maintain-framerate'`, instruindo o codificador a priorizar a taxa de quadros e nunca sofrer com engasgos.
- **Aceleração por Hardware (H.264):** Priorização do codec H.264 via `setCodecPreferences` para reduzir o uso de CPU e acionar codificação por GPU (NVENC, Intel QuickSync, AMD AMF).
- **Zerar Jitter Buffer:** Configuração de `jitterBufferTarget = 0` e `playoutDelayHint = 0` nos receptores para reprodução instantânea dos pacotes de vídeo.
- **Áudio Estéreo Opus Gamer 128 kbps:** Injeção no SDP para áudio estéreo real em 48 kHz CBR com `stereo=1;sprop-stereo=1;cbr=1`.
- **VU Meter Estéreo L / R:** Analisador visual de áudio estéreo em tempo real utilizando Web Audio API (`AudioContext`, `ChannelSplitterNode`).
- **Tuning em Tempo Real:** Slider dinâmico de bitrate (2.5 a 16 Mbps) e perfis prontos (Ultra 720p60, Balanced 1080p60 e High 1080p60).
- **HUD de Telemetria Integrado:** Medição ao vivo de FPS, ping/latência RTT (ms), bitrate consumido (Mbps) e resolução atual através de `RTCPeerConnection.getStats()`.
- **Recursos de Player:** Picture-in-Picture (PiP), tela cheia e controle de áudio independente.

---

## 📁 Arquitetura Modular

```
SeeMyGame/
├── css/
│   ├── main.css          # Variáveis de design, layout, cabeçalho, painel de tuning, modal e toasts
│   └── player.css        # Grade multi-stream, cartões de vídeo, HUD de telemetria e VU meter estéreo
├── js/
│   ├── config.js         # Servidores STUN/TURN, perfis de qualidade e constantes de bitrate
│   ├── webrtc.js         # Motor WebRTC: SDP mangling, preferência H.264, zero jitter buffer e FPS lock
│   ├── audio.js          # Analisador estéreo Web Audio API e loop do VU meter
│   ├── stats.js          # Coletor de telemetria via getStats (FPS, RTT, bitrate e resolução)
│   ├── ui.js             # Manipulação do DOM, toasts, modal de termos e gerenciamento de cartões de vídeo
│   └── app.js            # Orquestrador central: PeerJS, captura de tela (getDisplayMedia) e eventos
├── index.html            # Ponto de entrada limpo e semântico
└── README.md             # Documentação do projeto
```

---

## 🚀 Como Executar Localmente

Como a aplicação é modular e utiliza ES Modules (`<script type="module">`), ela deve ser servida através de um servidor HTTP local simples:

### Opção 1: Usando Python
```bash
python -m http.server 8080
```
Acesse no navegador: `http://localhost:8080`

### Opção 2: Usando Node / npx
```bash
npx serve .
```

### Opção 3: Extensão VSCode / IDE
Utilize a extensão **Live Server** ou similar e abra o `index.html`.

---

## 🌐 Como Compartilhar com Amigos

1. Clique em **"Transmitir Jogo"** e selecione a janela ou tela desejada (lembre-se de marcar a opção de compartilhar áudio do sistema).
2. Clique no botão **"Copiar Link"** (ou copie seu ID gerado no topo).
3. Envie o link ou ID para seus amigos. Quando eles abrirem o link ou colarem o ID no campo "Assistir Amigo", a transmissão será iniciada em tempo real ponto-a-ponto!
