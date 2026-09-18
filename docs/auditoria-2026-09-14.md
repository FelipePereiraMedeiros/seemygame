**Auditoria técnica do SeeMyGame — revisão de 14/09/2026**

Esta revisão considera o commit `6c77eb891ca1efec3f890c38b867cdfe9db435ec`, na branch `mason`, **incluindo as alterações locais ainda não commitadas**. Ela substitui as conclusões preliminares feitas sobre `d5d69ba`. Os arquivos foram reavaliados após a solicitação de atualização; os hashes dos 86 arquivos versionados permaneceram estáveis durante a revalidação principal, aproximadamente entre 19h03 e 19h10, horário de Brasília.

O projeto é um protótipo funcional com bastante implementação e uma suíte unitária útil, mas **ainda não está pronto para ser distribuído como uma solução segura de salas privadas ou controle remoto de jogos**. Os principais impeditivos são autorização incompleta, XSS, retransmissão cíclica de mensagens na nova malha P2P e fragilidade do agente de input. A compilação passar não elimina esses problemas: vários foram reproduzidos com os próprios módulos da aplicação e não são detectados pelos testes existentes.

Não foram alterados código-fonte, dependências, drivers ou configurações do sistema nesta reavaliação. Foram executados testes e verificações locais e produzido este relatório. O Companion não foi iniciado; as provas de segurança utilizaram conexões, mídia e input simulados, sem enviar conteúdo a outras pessoas.

**Estado atual e mudanças desde a primeira leitura**

| Área | Estado reavaliado |
|---|---|
| Aplicação web | JavaScript em ES Modules, HTML/CSS, WebRTC e PeerJS 1.5.2 por CDN. Há quatro páginas: portal, sala, streamer e viewer. |
| Salas | Novo `RoomManager`, coordenador com ID previsível e intenção de malha completa de dados/voz. A integração ainda mistura a arquitetura anterior de streamer/espectadores com a nova arquitetura de salas. |
| Desktop | Tauri 2; o lockfile resolve `tauri` 2.11.5. Enumera janelas, altera a prioridade do próprio processo e agora permite alternar always-on-top. Não há captura nativa de frames implementada em Rust. |
| Input remoto | Companion Python opcional, usando WebSocket e PyAutoGUI para teclado/mouse globais. Não implementa gamepad virtual. |
| Rede | Sinalização pública padrão do PeerJS; STUN/TURN de terceiros; endpoint Node opcional em `/api/turn`. |
| Ferramentas verificadas | Node 24.15.0, npm 10.8.1, Rust/Cargo 1.97.0, Python 3.12.2, Vitest 5.0.0, jsdom 30.0.1. |
| Python disponível | `websockets` 16.1.1 instalado; **PyAutoGUI não está instalado no Python 3.12.2 consultado**. Outros ambientes virtuais não foram inventariados. |

Houve melhorias reais: o hook de build Tauri agora chama `npm run build:dist`, corrigindo o antigo caminho que procurava `G:\tools\build-dist.js`; o build inclui `room.html`; a facecam ganhou proteção contra inicialização duplicada e chamadas concorrentes; o desktop ganhou controles explícitos de fixação; a identidade fixa deixou de ser aplicada indiscriminadamente ao viewer. A suíte passou de 274 para 304 testes.

Essas melhorias não corrigiram as falhas de confiança entre participantes. A nova arquitetura de salas também introduziu caminhos adicionais para vazamento de mídia e amplificação de mensagens.

**Validação executada**

| Verificação | Resultado atual | Limite da evidência |
|---|---|---|
| `npm run test:coverage` | **304 testes passaram, em 24 arquivos**, duração de 34,28 s. | Testes majoritariamente em jsdom com WebRTC, áudio e permissões simulados. |
| Cobertura geral | 72,66% statements; 56,15% branches; 66,29% functions; 74,54% lines. | Inclui arquivos de mocks. |
| Cobertura apenas de produção | **72,48% statements; 56,08% branches; 65,01% functions; 74,38% lines**, em 20 arquivos. | Recalculada do JSON de cobertura excluindo `/tests/`. Não cobre Rust/Python. |
| Cobertura do orquestrador | `app.js`: 59,20% statements e 43,32% branches. | É justamente onde se concentram protocolo, autorização e integração. |
| Cobertura da sala | `room.js`: 78,03% statements e 59,70% branches. | Não demonstra que três participantes reais operem corretamente. |
| `cargo check --locked --offline --all-targets` | **Passou**, em 47,17 s. | Verifica compilação; não comprova captura, abertura da janela nem empacotamento do instalador. |
| `cargo fmt --check` | **Falhou** em `build.rs`, `main.rs`, `system.rs` e `windows_list.rs`. | Débito de formatação, não vulnerabilidade. |
| `cargo clippy --locked --offline --all-targets -- -D warnings` | **Falhou** em `windows_list.rs:89`: `last()` sobre iterador de duas pontas; sugere `next_back()`. | Problema pequeno de qualidade, não impeditivo funcional por si só. |
| Build de arquivos estáticos | Cópia validada em pasta temporária: as quatro páginas conferem byte a byte e `js/room.js` está incluído. | O comando de encerrar processos foi interceptado; não equivale a executar um instalador de release. |
| `npm audit` | Na primeira etapa: **0 vulnerabilidades conhecidas reportadas em 112 dependências**. O lockfile npm permaneceu igual na reavaliação. | Não analisa código próprio, PeerJS externo ao lockfile, crates Rust ou pacotes Python. |
| `cargo audit --no-fetch --no-yanked --json` | 439 dependências examinadas; 0 entradas na categoria `vulnerabilities`, **6 avisos de manutenção e 1 de código potencialmente inseguro (`unsound`)**. | Base local com 1.243 advisories, sem atualização nesta execução e sem data de atualização informada; crates retiradas do registro não foram consultadas. |
| Integridade PeerJS | SHA-384 do bundle 1.5.2 conferiu com o SRI das páginas originais; a nova sala utiliza o mesmo URL/hash. | SRI garante integridade daquele conteúdo, não ausência de falhas nele. |
| Python | Sintaxe do Companion validada por AST; versões consultadas por metadados. | Nenhum comando de input foi executado. |

As mensagens de teste sobre `canvas.getContext` e navegação não implementados em jsdom são relevantes: representam áreas simuladas ou ausentes, não validação de renderização real. Não foram realizados testes de partida, instalação limpa, TURN real em CGNAT, áudio real, fullscreen exclusivo, longa duração ou múltiplas máquinas.

Na árvore Rust, os avisos de manutenção são `proc-macro-error` 1.0.4 e cinco crates `unic-*` 0.9.0 (`unic-char-property`, `unic-char-range`, `unic-common`, `unic-ucd-ident`, `unic-ucd-version`). O aviso `unsound` é de `glib` 0.18.5, associado a iteradores de `VariantStrIter`, corrigido a partir de 0.20.0. **`cargo tree` confirmou que `glib` não participa da árvore do alvo `x86_64-pc-windows-msvc` consultado**; não atribuo esse risco diretamente ao executável Windows. Continua sendo dívida de dependências/plataformas do lockfile. Os avisos são distintos de uma exploração demonstrada. [RustSec: proc-macro-error](https://rustsec.org/advisories/RUSTSEC-2024-0370.html), [RustSec: família UNIC](https://rustsec.org/advisories/RUSTSEC-2025-0081.html), [RustSec: glib](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).

As prioridades abaixo são de engenharia: **P1** deve ser resolvido antes de disponibilizar o recurso a participantes não confiáveis; **P2** afeta confiabilidade, correção ou operação; **P3** é melhoria de manutenção. Não foi atribuída pontuação CVSS nem alegada exploração em produção.

**Achados prioritários de segurança e privacidade**

**A01 — P1 — XSS remoto persiste e se ampliou para os nomes dos membros da sala.**

O chat recebe objetos remotos em `addMessage` sem normalizar o conteúdo e interpola campos em `innerHTML`. Os nomes/atributos da voz seguem o mesmo padrão. A nova presença de sala também insere `m.name` e identificadores em HTML. Assim, não basta sanitizar a mensagem criada pela interface local: um cliente pode enviar diretamente um objeto diferente.

Evidências: [chat.js:84](G:/SeeMyGame/js/chat.js:84), [discord-ui.js:419](G:/SeeMyGame/js/discord-ui.js:419), [discord-ui.js:509](G:/SeeMyGame/js/discord-ui.js:509), [discord-ui.js:690](G:/SeeMyGame/js/discord-ui.js:690) e [discord-ui.js:722](G:/SeeMyGame/js/discord-ui.js:722).

Reprodução atual: HTML enviado como texto/nome foi interpretado; o clique em um botão inofensivo de prova executou um event handler que apenas marcou `document.body.dataset`. Resultado: `chatEventExecuted=true` e `roomEventExecuted=true`. Não houve tráfego externo. O impacto possível é executar JavaScript com os acessos da aplicação, incluindo ler seu armazenamento e usar as sessões de mídia já concedidas.

Recomendação: construir conteúdo remoto com `textContent`; validar formato, comprimento e enumerações na recepção; derivar identidade e papel da conexão autenticada. Qualquer HTML legítimo de sistema precisa de um caminho local separado. Habilitar uma CSP restritiva como defesa complementar, não como substituição da correção. A proteção CSP do Tauri depende de configuração; atualmente está `null`. [Documentação Tauri](https://v2.tauri.app/security/csp/).

**A02 — P1 — PIN incorreto não impede entrada efetiva nem recebimento de vídeo na nova sala.**

Na abertura da conexão, o app chama `roomManager.registerConnection` antes de validar o pedido de entrada. Isso já adiciona o cliente aos membros e à malha. Depois, `ROOM_JOIN_REQUEST` pode responder `ROOM_PIN_REQUIRED`, mas não remove essa admissão. Ao transmitir, o app chama todos os integrantes de `meshConnections` sem filtrar autorização.

Evidências: [app.js:1285](G:/SeeMyGame/js/app.js:1285), [room.js:127](G:/SeeMyGame/js/room.js:127), [room.js:185](G:/SeeMyGame/js/room.js:185) e [app.js:1951](G:/SeeMyGame/js/app.js:1951).

Reprodução atual: sala criada com PIN `1234`, conexão com PIN errado; a resposta recusou o pedido, mas `stillMember=true` e `receivedScreen=true`. Há ainda duas fontes de senha não sincronizadas: `RoomManager.roomPin` vem da URL, enquanto o campo da interface grava `seemygame_streamer_pin` no localStorage. O protocolo `ROOM_PIN_REQUIRED` não possui tratamento efetivo de resposta equivalente ao `PIN_REQUIRED` antigo.

Recomendação: uma única máquina de estados por conexão, separando pendente, autenticada e autorizada; somente admitir na malha após validação. Todos os caminhos de vídeo, voz, dados e presença devem consultar a mesma autorização. Limitar tentativas e tempo de conexão pendente.

**A03 — P1 — Qualquer conexão pode falsificar sincronização/identidade da sala e redirecionar microfones.**

`ROOM_SYNC_ALL` não verifica se o remetente é o coordenador autorizado. O app processa mensagens `ROOM_*` antes da verificação de PIN antiga e usa a lista recebida para conectar a novos peers e chamar esses peers com o microfone local. Outros comandos aceitam `message.peerId` para modificar/remover participantes diferentes do remetente.

Evidências: [app.js:1327](G:/SeeMyGame/js/app.js:1327), [room.js:228](G:/SeeMyGame/js/room.js:228), [room.js:251](G:/SeeMyGame/js/room.js:251) e [room.js:279](G:/SeeMyGame/js/room.js:279). O caminho antigo `VOICE_SIGNAL/HOST_VOICE_ACTIVE` também confia no `data.peerId`: [app.js:981](G:/SeeMyGame/js/app.js:981).

Reprodução atual: uma conexão enviou uma lista falsa contendo um peer ausente; o app conectou a ele e chamou esse destinatário com a stream de microfone simulada: `connectedToInjectedPeer=true`, `sentMicrophone=true`. Isso depende de o usuário já ter concedido/capturado o microfone; não contorna a permissão inicial do navegador.

Recomendação: autenticar o coordenador, exigir admissão verificável para cada membro e vincular mensagens de estado ao remetente real. Nunca iniciar mídia para um ID arbitrário apenas porque ele apareceu em um payload remoto. Testar remetente não autorizado, lista falsa, mudança de papel e alteração de outro membro.

**A04 — P1 — O PIN antigo também não cobre chat transmitido e chamadas de voz.**

`broadcastDataMessage` envia para `connectedViewers` sem filtrar `authenticatedViewers`; `handleIncomingVoiceCall` considera a presença na conexão suficiente e responde com o microfone. Esses caminhos permanecem na revisão atual e são reutilizados pela sala.

Evidências: [app.js:889](G:/SeeMyGame/js/app.js:889) e [app.js:942](G:/SeeMyGame/js/app.js:942). Na etapa inicial foram reproduzidos recebimento de chat privado e de microfone com `authenticated=false`; a leitura diferencial confirmou que a falta de verificação permanece.

Recomendação: centralizar o controle de acesso, cobrindo saída e entrada. O PIN atualmente oferece uma impressão de privacidade maior do que a implementação entrega.

**A05 — P1 — O Companion permite controle local sem pareamento ou autorização própria.**

O WebSocket escuta em `127.0.0.1:9876` e aceita mensagens de teclado/mouse imediatamente. Não há token, validação de `Origin`, vínculo à sessão aprovada nem exclusividade de cliente. Qualquer processo que alcance esse endpoint pode ignorar o modal de autorização do navegador. Uma página externa também pode ser vetor quando as políticas de acesso à rede local daquele navegador permitirem; não se presume que todos os navegadores permitam esse acesso.

Evidência: [coop-agent.py:49](G:/SeeMyGame/tools/coop-agent.py:49) e [coop-agent.py:103](G:/SeeMyGame/tools/coop-agent.py:103). O parâmetro `origins` é documentado como defesa contra sequestro de WebSocket por outra origem. [websockets](https://websockets.readthedocs.io/en/stable/reference/asyncio/server.html).

Recomendação: pareamento explícito com token efêmero, origem restrita, sessão e permissões validadas no agente; limites de frequência/tamanho, cliente único, protocolo versionado e expiração. Loopback restringe a rede de acesso, mas não autentica o cliente.

**A06 — P1 — O botão de pânico não garante interromper o controle do PC.**

O Python desativa `pyautogui.FAILSAFE`, não mantém estado de teclas/botões pressionados e não libera tudo ao desconectar. A revogação JavaScript muda o estado da aplicação sem enviar um reset ao agente. O Escape é capturado pela janela web e não é um atalho global disponível com o jogo em foco.

Evidências: [coop-agent.py:28](G:/SeeMyGame/tools/coop-agent.py:28), [coop-agent.py:68](G:/SeeMyGame/tools/coop-agent.py:68), [coop.js:159](G:/SeeMyGame/js/coop.js:159) e [app.js:298](G:/SeeMyGame/js/app.js:298). O próprio PyAutoGUI recomenda preservar o failsafe. [PyAutoGUI](https://pyautogui.readthedocs.io/en/latest/).

Recomendação: manter conjunto de inputs ativos; enviar/liberar `all-up` em revogação, desconexão, encerramento e timeout; watchdog nativo; emergência nativa independente. Uma combinação registrada com [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey) merece avaliação, com tratamento de falha no registro. Validar `down → queda/revogação` com backend simulado antes de input real.

**A07 — P1 — Push-to-talk pode reentrar com microfone aberto.**

`leaveVoice` reseta mute, mas preserva `voiceMode='ptt'`; a nova `joinVoice` não aplica o estado do PTT à nova track. Na reprodução atual, a primeira entrada tinha `track.enabled=false`; após sair/entrar, `voiceMode='ptt'`, `isPttActive=false` e **`track.enabled=true`**.

Evidências: [voice.js:42](G:/SeeMyGame/js/voice.js:42), [voice.js:92](G:/SeeMyGame/js/voice.js:92) e [voice.js:163](G:/SeeMyGame/js/voice.js:163). Recomendação: função única de aplicação de mute/PTT a cada track nova; estado seguro ao reconectar/perder foco; testes de entrada, saída, blur e troca de dispositivo.

**A08 — P1 — A malha de três participantes retransmite mensagens em ciclo.**

A aplicação continua retransmitindo mensagens como se fosse um hub. Na nova malha, cada participante também retransmite. Além disso, uma mesma conexão aparece em `connectedViewers` e `meshConnections`, e o broadcast usa as duas coleções. Não há deduplicação por ID, controle de origem ou limite de saltos.

Evidências: [app.js:889](G:/SeeMyGame/js/app.js:889), [app.js:956](G:/SeeMyGame/js/app.js:956) e [room.js:374](G:/SeeMyGame/js/room.js:374).

Reprodução atual com três instâncias dos módulos e uma fila de mensagens simulada: um chat gerou quatro entregas iniciais; após limitar o teste a 60 entregas, **ainda havia 64 pendentes**. Nenhuma rede real foi usada. Isso demonstra amplificação contínua de um evento normal, com impacto potencial em CPU, memória, tráfego e reprodução repetida de sons.

Recomendação: escolher claramente entre distribuição por coordenador e malha. Na malha completa, distribuir cada evento uma vez aos destinatários, sem retransmissão indiscriminada; deduplicação e limites continuam necessários para reconexões/clientes defeituosos. Adicionar teste de três ou mais peers que demonstre fila finita e uma entrega lógica por participante.

**Outros achados de funcionamento, desempenho e operação**

| ID / prioridade | Evidência atual | Consequência e encaminhamento |
|---|---|---|
| A09 / P2 — Convite da sala sobrescrito | `setupRoomSession` define link `#room=...`, mas depois o handler de abertura de `initPeer` substitui por `viewer.html#watch=...`. [app.js:631](G:/SeeMyGame/js/app.js:631), [app.js:736](G:/SeeMyGame/js/app.js:736). | Reproduzido: convite da sala retornou o link legado. Preservar roteamento por modo; configurar origem pública para convites criados pelo desktop, pois a origem local do Tauri não é um site acessível aos amigos. |
| A10 / P2 — Inicialização duplicada | `initGamerFeatures` roda no carregamento do módulo e novamente em `DOMContentLoaded`. [app.js:3232](G:/SeeMyGame/js/app.js:3232), [app.js:3259](G:/SeeMyGame/js/app.js:3259). | A facecam recebeu proteção, mas ABR e outros handlers não. Reproduzido: duas inicializações fazem um clique no ABR alternar duas vezes e terminar no estado inicial. Tornar todo bootstrap idempotente. |
| A11 / P2 — Lousa e áudio meme não chegam ao dispatcher | Há handlers `WHITEBOARD_*` e `SOUNDBOARD_PLAY_CUSTOM`, mas as listas aceitas nos dois roteadores não os incluem. [app.js:1380](G:/SeeMyGame/js/app.js:1380), [app.js:1686](G:/SeeMyGame/js/app.js:1686). | Os módulos funcionam isoladamente e a interface anuncia sincronização, mas mensagens reais desses tipos são descartadas. Unificar o roteador tipado, aplicando autorização/limites antes de habilitar os tipos. |
| A12 / P2 — Gamepad e jogos web anunciados além do suporte real | `INPUT_GAMEPAD` é enviado pelo JS, mas o Python só trata teclado/mouse. O fallback web de teclado despacha no `window` do SeeMyGame. [coop.js:177](G:/SeeMyGame/js/coop.js:177), [coop.js:210](G:/SeeMyGame/js/coop.js:210), [coop-agent.py:59](G:/SeeMyGame/tools/coop-agent.py:59). | Não existe controle virtual de Player 2. O fallback não controla automaticamente um jogo aberto em outra aba/origem. Mouse/gamepad não têm equivalente web nesse caminho. Criar handshake de capacidades e documentar integrações efetivamente suportadas. |
| A13 / P1–P2 — Escopo e coordenadas do input | Teclado é capturado no `window` do viewer, inclusive campos editáveis; Python atua no desktop ativo e converte coordenadas para o monitor primário. [coop.js:327](G:/SeeMyGame/js/coop.js:327), [coop.js:410](G:/SeeMyGame/js/coop.js:410), [coop-agent.py:51](G:/SeeMyGame/tools/coop-agent.py:51). | Texto digitado no chat pode virar input remoto; mudar o foco do host pode aplicar comandos a outra aplicação. Janela/monitor secundário/DPI/barras no vídeo deslocam cliques. Restringir foco e janela autorizada; ignorar campos editáveis; mapear a área real capturada. |
| A14 / P1–P2 — Seletor desktop inseguro e não vinculante | Título de janela entra em `innerHTML`; clique não passa `win.id` à captura. [app.js:2125](G:/SeeMyGame/js/app.js:2125), [app.js:2133](G:/SeeMyGame/js/app.js:2133). | Outro aplicativo/página pode fornecer título com HTML. A captura continua abrindo o seletor genérico de `getDisplayMedia`. Usar DOM seguro e remover a falsa vinculação ou implementar captura nativa de janela. Via de XSS identificada estaticamente, sem executar exploração desktop. |
| A15 / P2 — Gravação de replay não é robusta | Recorder inicia antes de anexar o microfone; o buffer descarta chunks iniciais e concatena os restantes; uma instância global é usada para múltiplos vídeos. [app.js:1877](G:/SeeMyGame/js/app.js:1877), [app.js:1896](G:/SeeMyGame/js/app.js:1896), [clipping.js:51](G:/SeeMyGame/js/clipping.js:51). | Alterar o conjunto de tracks durante a gravação pode encerrá-la por `InvalidModificationError`; chunks isolados não têm garantia de arquivo reproduzível. O botão de um cartão também não escolhe um recorder próprio daquele cartão. Usar stream estável, tratamento de erros e segmentos/remux adequados; validar arquivos reais após mais de 30 s. |
| A16 / P2 — TURN dinâmico sofre corrida e cache sem expiração | Fetch é iniciado em segundo plano e `initPeer` pode rodar antes da resposta; cache do módulo não tem TTL. [app.js:3247](G:/SeeMyGame/js/app.js:3247), [config.js:59](G:/SeeMyGame/js/config.js:59). | Reproduzido na configuração: o objeto inicial mantém fallback mesmo após resposta dinâmica. Aguardar inicialização com timeout e atualizar credenciais para novas sessões/reconexões. |
| A17 / P2 — ABR compartilha estado de todos os destinatários | Um único controlador recebe amostras de cada chamada; preset/slider não atualizam sempre o alvo interno. Ausência de RTT/perda vira zero. [app.js:1437](G:/SeeMyGame/js/app.js:1437), [app.js:2507](G:/SeeMyGame/js/app.js:2507), [abr.js:43](G:/SeeMyGame/js/abr.js:43). | Um espectador ruim reduz todos; quatro amostras ruins reduzem 7,5 Mbps para aproximadamente 2,37 Mbps, contra 5,63 Mbps após uma amostra. Decidir ABR por sender ou agregar por janela temporal; tratar amostra desconhecida como desconhecida. |
| A18 / P2 — Unidade errada de jitter no modo estável | `jitterBufferTarget` e `playoutDelayHint` recebem ambos `0.05`. [webrtc.js:193](G:/SeeMyGame/js/webrtc.js:193). | O primeiro usa milissegundos: para 50 ms seria `50`. O modo também não aparece conectado a uma escolha efetiva nas chamadas atuais. Testar APIs e suporte por navegador; parâmetro é uma preferência, não garantia de atraso. |
| A19 / P2 — Prioridade e topmost por padrão | Tauri define HIGH_PRIORITY_CLASS e always-on-top no início; configuração também fixa a janela. [system.rs:9](G:/SeeMyGame/src-tauri/src/system.rs:9), [lib.rs:18](G:/SeeMyGame/src-tauri/src/lib.rs:18), [tauri.conf.json:26](G:/SeeMyGame/src-tauri/tauri.conf.json:26). | Prioridade de CPU não é prioridade de GPU nem seleção de NVENC. Pode disputar tempo com o jogo; topmost pode cobrir a janela jogada. Preferir opção persistida e medir ganho antes de elevar prioridade. |
| A20 / P2 — Build encerra aplicativos em execução | `build-dist.js` chama `taskkill /F /IM seemygame.exe` em todo build no Windows. [build-dist.js:5](G:/SeeMyGame/tools/build-dist.js:5). | Pode derrubar uma sessão ativa e perder gravação/estado; o filtro é nome de executável, não instância deste checkout. Separar o encerramento do build e gerenciar apenas o processo iniciado pela ferramenta de desenvolvimento. O comando foi interceptado na auditoria. |
| A21 / P2 — Reserva de ID não é identidade persistente | Coordenador tem ID derivado do nome da sala e o primeiro cliente que o ocupa assume master. [room.js:29](G:/SeeMyGame/js/room.js:29), [app.js:660](G:/SeeMyGame/js/app.js:660). | Nome/ID não prova propriedade. O portal cria nomes aleatórios com apenas 900 combinações; não tratá-los como segredo. Definir identidade do coordenador, convite imprevisível e regra explícita para saída/falha do master. |
| A22 / P2 — Limites incompletos | Limite de viewers é conferido antes de `open`; membros declarados, canais e mensagens não têm validação central equivalente. [app.js:1273](G:/SeeMyGame/js/app.js:1273), [room.js:228](G:/SeeMyGame/js/room.js:228), [chat.js:84](G:/SeeMyGame/js/chat.js:84). | Conexões pendentes podem consumir vagas ou passar simultaneamente na checagem. Histórico de 200 itens por canal não limita número de canais nem bytes. Definir quotas por sessão/membro, máximo de payload e backpressure. |

As conclusões sobre gravação seguem a especificação: modificar tracks durante gravação exige parada/erro, e blobs individuais de `timeslice` não precisam ser reproduzíveis separadamente. O comportamento dos arquivos finais ainda deve ser medido em navegadores reais. [W3C MediaStream Recording](https://www.w3.org/TR/mediastream-recording/). A unidade de jitter é confirmada na [documentação MDN](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget). A prioridade de processo é explicada pela [Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setpriorityclass). O próprio [PeerJS alerta que o ID é para intermediar conexões, não estabelecer identidade](https://peerjs.com/client/api/peer).

**TURN, conectividade e custo operacional**

O endpoint [turn.js:6](G:/SeeMyGame/api/turn.js:6) permite acesso público, usa CORS `*` e retorna a mesma configuração privada do provedor sem autenticação, quota por usuário ou limitação de frequência no código. Se for publicado com uma credencial faturável e sem controles externos, terceiros poderão obter essa credencial e consumir sua franquia. CORS restritivo sozinho não impede clientes externos ao navegador. Não foi verificada a configuração do provedor/hospedagem; controles externos podem reduzir esse risco.

O endpoint **consulta credenciais**, não demonstra emissão de credenciais novas de curta duração. A expiração depende da configuração no Metered. A API key de uma credencial, documentada como utilizável no frontend, é diferente da Secret Key administrativa; a auditoria não classifica ambas como a mesma coisa. Implementar emissão/rotação, expiração, cache compatível e controle de consumo conforme o modelo do produto. [Metered: criação e credenciais](https://www.metered.ca/docs/turn-server-service/creating-turn-credentials/).

Os fallbacks do frontend e da API divergem: o frontend contém `turns:` TCP, enquanto a API usa `turn:` TCP no trecho equivalente. Não há teste real de relay, timeout explícito do fetch nem validação completa da resposta. Servir apenas arquivos estáticos ou abrir o bundle Tauri não executa automaticamente `/api/turn`.

O README promete “100% de conectividade” e o comentário da API cita 50 GB/mês. A página atual do Open Relay informa **20 GB/mês** e orienta obter credenciais por conta/API. Isso não prova que o endpoint antigo esteja desligado; prova que as premissas documentais devem ser revistas. [Open Relay oficial](https://www.metered.ca/tools/openrelay/).

Estimativa de ordem de grandeza, não medição: a 7,5 Mbps, cada cópia de vídeo corresponde a aproximadamente **3,375 GB por hora** antes de áudio e overhead. Quatro espectadores consomem aproximadamente 30 Mbps de upload e 13,5 GB/h de vídeo transmitido. A cobrança de TURN depende da contabilização do provedor. Em malha de N pessoas, pode haver N(N−1)/2 pares de conexão; múltiplos streams simultâneos aumentam custo de upload e codificação.

P2P pode revelar endereços de rede ao outro endpoint. Um modo relay-only pode diminuir essa exposição, com custo e latência adicionais; não é implementado como opção de privacidade hoje. A especificação prevê esse uso de `iceTransportPolicy='relay'`. [W3C WebRTC](https://w3c.github.io/webrtc-pc/#rtcicetransportpolicy-enum).

**Vanguard e outros anticheats: avaliação por mecanismo**

É necessário distinguir três resultados: o recurso deixar de funcionar; o jogo recusar iniciar por causa de um software/driver; e a conta sofrer uma penalidade. **Não foi demonstrado bloqueio ou banimento do SeeMyGame/PyAutoGUI por Vanguard**, e esta auditoria não certifica compatibilidade. O risco abaixo é arquitetural, salvo onde há histórico oficial citado.

| Componente ou ferramenta | Situação | Avaliação |
|---|---|---|
| Navegador, WebRTC e `getDisplayMedia` | Existentes | Menor exposição relativa: o projeto não injeta código no processo do jogo para capturar. É o caminho preferível para transmissão com jogos protegidos, sujeito a testes de captura/áudio/fullscreen. |
| Tauri e enumeração Win32 | Existentes | `OpenProcess` usa apenas `PROCESS_QUERY_LIMITED_INFORMATION` para obter metadados. Não foram encontrados leitura/escrita de memória do jogo, patch, DLL injetada ou driver próprio. A presença de `OpenProcess` isoladamente não justifica classificar o app como cheat. |
| PyAutoGUI / Companion | Existente, dependência ausente no Python consultado | Maior atenção: sintetiza teclado/mouse globais. O backend Windows oficial usa `keybd_event`, `mouse_event` e `SetCursorPos`. Pode não funcionar com input/proteções de determinados jogos; não há evidência primária de aprovação ou banimento específico. |
| Gamepad virtual / ViGEmBus | Ausente | Acrescentaria um driver kernel e poderia criar dispositivo separado para P2, mas ViGEmBus está arquivado e sem manutenção. Não adotá-lo como nova dependência sem decisão de suporte/manutenção. EOL não prova banimento. |
| OBS Game Capture e hooks próprios | Ausentes; OBS pode servir como comparação | Há histórico oficial concreto: OBS 31.1.0 corrigiu assinaturas de hooks para jogos Riot com Vanguard. Demonstra que certificados/hooks importam, não que OBS seja proibido. Evitar implementar hook próprio sem necessidade comprovada. |
| Always-on-top | Implementado agora | É uma janela comum sobre outras, não um overlay injetado. Risco predominante atual é usabilidade/foco/desempenho; não há evidência de conflito específico com Vanguard. |
| Atalho global nativo | Ainda ausente | Útil para emergência/PTT. Avaliar API oficial `RegisterHotKey`, sem driver de interceptação. Deve funcionar com o jogo em foco e falhar de forma explícita se não conseguir registrar. |
| Windows.Graphics.Capture | Possível evolução | API oficial para captura nativa real. Adequada a um protótipo futuro de seleção efetiva de janela, com consentimento e métricas. Ser API oficial não equivale a whitelist de anticheat. |
| Node, Vitest, jsdom, Cargo e linters | Ferramentas de desenvolvimento | Não implementam hooks de jogo neste projeto. A suíte de teste não é o principal foco da análise de anticheat. Evitar anexar depuradores ao jogo protegido como método rotineiro de validar o SeeMyGame. |

Fontes dos mecanismos: [backend Windows do PyAutoGUI](https://github.com/asweigart/pyautogui/blob/master/pyautogui/_pyautogui_win.py), [ViGEm End of Life](https://docs.nefarius.at/projects/ViGEm/End-of-Life/), [release OBS 31.1.0](https://github.com/obsproject/obs-studio/releases/tag/31.1.0) e [captura de tela Microsoft](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture).

A Riot anunciou em 24/06/2026 um modo Vanguard on-demand opcional para máquinas elegíveis; portanto, a afirmação de que Vanguard obrigatoriamente inicia no boot em qualquer configuração não é universal. A publicação discute a segurança da plataforma, mas não concede aprovação ao SeeMyGame. [Riot: Vanguard on-demand](https://www.riotgames.com/en/news/vanguard-on-demand).

O [FAQ oficial do BattlEye](https://www.battleye.com/support/faq/) também distingue bloqueios/kicks de banimentos. Não se deve transferir uma regra do BattlEye para Vanguard ou Easy Anti-Cheat. Não foi encontrada uma declaração primária específica sobre SeeMyGame/PyAutoGUI com EAC.

Minha recomendação de produto é um **modo somente transmissão**, que não conecta ao Companion nem habilita controle remoto, e um modo co-op separado, com escopo explícito e jogos suportados. Hoje o app tenta conectar ao Companion ao iniciar a transmissão, mesmo sem um pareamento específico para aquela sessão. A compatibilidade deve ser registrada por versão de Windows, navegador/WebView2, GPU/driver, jogo, anticheat e versão do aplicativo. Falhas não devem ser “resolvidas” automaticamente com privilégios maiores, desligamento de proteções ou instalação de drivers antigos.

**Ferramentas que trariam mais retorno**

Estas são recomendações, não instalações realizadas. O maior ganho vem de testar as fronteiras reais de protocolo e mídia, não de aumentar indiscriminadamente a lista de bibliotecas.

| Prioridade | Ferramenta/prática | Aplicação concreta |
|---|---|---|
| Imediata | Testes de protocolo com 3–5 peers simulados | Cobrir autorização, falsificação de remetente, fila finita, deduplicação, reentrada, desligamento e rate limit. As reproduções desta auditoria devem virar regressões. |
| Imediata | [Playwright](https://playwright.dev/docs/browsers) | Testar o fluxo real portal → sala → convite, duas/três sessões, botões e permissões; complementar com testes manuais de captura e WebView2. Chromium, Firefox e WebKit ajudam a revelar diferenças. |
| Imediata | [ESLint](https://eslint.org/docs/latest/use/getting-started) + [TypeScript `checkJs`](https://www.typescriptlang.org/tsconfig/checkJs.html) | Checagem incremental em JS/JSDoc, contratos de mensagens e exaustividade do roteador. Não exige reescrever toda a aplicação. |
| Imediata | CI com npm ci, testes, build isolado, fmt e clippy | Executar em Windows e manter verificações de frontend portáveis. Sem matar aplicativos do usuário. Atualmente não há workflow versionado de CI no repositório. |
| Curto prazo | [cargo-audit/cargo-deny](https://rustsec.org/) e auditoria Python | Verificar advisories, manutenção, licenças e fontes, além do npm audit. Criar manifesto/lock para o Companion. |
| Curto prazo | [Ruff](https://docs.astral.sh/ruff/linter/) e testes Python com backend de input falso | Validar mensagens, exceptions, release-all, expiração e limites sem movimentar o mouse real. |
| Curto prazo | [Dependabot](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates) | Atualizações revisáveis para os ecossistemas suportados; incluir PeerJS no processo de atualização, hoje fora do lockfile. |
| Curto prazo | [Gitleaks](https://github.com/gitleaks/gitleaks) | Varredura completa do histórico e proteção no CI; a busca pontual por padrões nesta auditoria não substitui um scanner. O projeto informa manutenção focada em correções de segurança, sem novos recursos. |
| Curto prazo | [axe-core](https://github.com/dequelabs/axe-core) + testes de teclado | Verificar contraste/ARIA e principalmente foco, saída de modal, leitor de tela e controles de canvas. Os atributos ARIA atuais não provam acessibilidade completa. |
| Conforme necessidade | TURN próprio com [coturn](https://github.com/coturn/coturn) ou serviço gerenciado com métricas | Credenciais, regiões, relay-only, teste de conectividade e controle de consumo. Não é necessário migrar antes de medir a operação atual. |
| Conforme escala | SFU, por exemplo [LiveKit](https://docs.livekit.io/reference/internals/livekit-sfu/) | Avaliar quando upload, número de participantes ou múltiplos vídeos ultrapassarem a capacidade de P2P. Acrescenta infraestrutura e custo; não é a primeira correção para os bugs atuais. |
| Medição | [Windows Performance Recorder/Analyzer](https://learn.microsoft.com/en-us/windows-hardware/test/wpt/) | Medir CPU, agendamento e gargalos de captura/codificação no próprio app; comparar prioridade normal versus alta. |

Também seriam úteis como recursos do produto: diagnóstico antes de entrar na sala (captura, áudio e relay), painel com codec efetivamente negociado e motivo de limitação de qualidade, estado visível de quem recebe vídeo/microfone, escolha explícita de qual stream gravar, pareamento de Companion com capacidades, emergência verificável e exportação de diagnóstico com IPs/credenciais removidos.

**Arquitetura, documentação e critérios para avançar**

`app.js` concentra mais de 3.300 linhas e combina bootstrap, interface, identidade, duas topologias de rede, gravação, efeitos e controle remoto. A manutenção seria mais segura separando sessão/autorização, transporte/roteamento, mídia e UI. O protocolo deveria ter uma única tabela de tipos, schemas, remetentes permitidos e destinatários — isso ataca diretamente as falhas encontradas, sem exigir um framework novo.

Não há pinning explícito de toolchain Node/Rust/Python, manifesto Python, configuração de lint/CI ou licença textual versionada. `package.json` declara MIT enquanto os metadados Cargo têm licença/repositório/autoria incompletos. O release inclui `devtools` e logs de eventos da janela; revisar necessidade, retenção e conteúdo antes de distribuição. Empacotar PeerJS localmente reduz dependência de CDN em runtime e permite inventário único.

O README está significativamente atrás do código: não descreve o fluxo principal de salas, exagera a proteção contra XSS e a conectividade, e anuncia suporte de gamepad/browser além da implementação. Os termos de interface descrevem tráfego exclusivamente entre navegadores, mas TURN pode retransmiti-lo; o texto deve explicar sinalização, relay e gravações locais de maneira precisa. Isso é uma observação de consistência técnica, não uma revisão jurídica.

Ordem recomendada de trabalho:

1. **Fechar as fronteiras de confiança:** A01–A07, admissão única da sala, destino permitido para mídia e proteção do Companion. Validar com testes negativos de protocolo.
2. **Corrigir a malha:** A08, deduplicação, limite de membros e comportamento quando o coordenador sai. Critério: um evento alcança cada participante uma única vez e a fila se esgota.
3. **Consolidar o fluxo do produto:** convite correto, PIN funcional, inicialização única, capacidades reais de co-op e roteamento da lousa/áudio meme.
4. **Validar mídia de verdade:** reprodução/exportação de clips acima de 30 s, entrada de microfone, troca de áudio, múltiplos streams, relay e redes com perda/jitter. Registrar latência ponta a ponta e qualidade, não inferi-las apenas do RTT.
5. **Preparar distribuição:** build sem encerramento forçado, toolchains e dependências reproduzíveis, CI, instalador testado, assinatura/configuração de release e matriz de compatibilidade por jogo.

Antes de alegar compatibilidade com Vanguard, o caminho somente transmissão deve ser testado separadamente do controle remoto. Antes de alegar sala privada, nenhum peer pendente/rejeitado pode receber mídia ou dados privados. Antes de alegar replay funcional, o arquivo exportado precisa abrir fora do próprio app após o descarte dos primeiros segmentos. Esses são critérios verificáveis de liberação, não garantias obtidas pela simples presença de testes unitários.

As lacunas restantes da auditoria são explícitas: nenhum jogo/anticheat foi executado; não houve inventário completo de programas/drivers da máquina, teste de instalador assinado ou acesso à hospedagem/configuração privada do TURN. Os resultados descrevem o código e as ferramentas observados, não certificam o ambiente de produção.

Para permitir comparar esta revisão com alterações posteriores, os hashes dos arquivos examinados e um resumo das provas estão no [snapshot da auditoria](G:/SeeMyGame/docs/auditoria-2026-09-14-snapshot.json). O relatório não aplica automaticamente as correções sugeridas.
