# Revisão do projeto — 16/09/2026

## Parecer

O projeto avançou de uma estrutura preliminar para uma implementação nativa com GStreamer, captura de janela/monitor, áudio e negociação WebRTC. Ainda não considero a versão pronta para distribuição: existem falhas de autorização na integração de `app.js`, problemas no ciclo de vida do processo de captura, incompatibilidade no caminho AV1 e lacunas nos testes de integração.

Esta revisão considera os arquivos atuais, inclusive arquivos novos ainda não versionados. A base Git permanece em `6c77eb8`; o diff rastreado contém 52 arquivos, 7.306 inserções e 830 exclusões. Esse número não inclui módulos novos não rastreados. Resultados de setembro/14 e setembro/15 não equivalem a uma validação desta versão.

Não foram instalados drivers, iniciada captura da tela/microfone, enviados comandos reais de entrada, publicados builds ou alterado código de produção nesta revisão. Os testes de mídia executados usam negociação e RTP sintéticos.

## Problemas prioritários

### R01 — P1: conexão de dados é tratada como autorização para receber voz

Em `js/app.js:1822`, uma conexão entra em `connectedViewers` antes de passar pelo PIN. Em `js/app.js:1414`, `handleIncomingVoiceCall` consulta apenas a presença nesse mapa ou em `watchingHosts`, e responde com o microfone local. Portanto, com o microfone ativo, conectar o canal de dados pode permitir receber voz antes da autorização. O bloqueio do vídeo por PIN não protege esse caminho.

Além disso, `HOST_VOICE_ACTIVE` em `js/app.js:1462` usa `data.peerId` para escolher a quem enviar o microfone. O destino vem da mensagem, sem associação obrigatória ao remetente autorizado. Corrigir ambos os caminhos com uma política única de autorização, incluindo membros autenticados da sala, e derivar a identidade da conexão.

### R02 — P1: sincronização rejeitada ainda provoca conexões e envio de voz

`js/room.js:433` devolve `true` ao rejeitar um `ROOM_SYNC_ALL` de origem inválida. Esse retorno significa mensagem tratada, não autorização. Entretanto, `js/app.js:1862` interpreta o retorno como suficiente para percorrer o payload original, conectar a seus membros e chamar esses peers com o microfone nas linhas 1866–1870.

O controle dentro de RoomManager existe, mas a integração o contorna. A aplicação deve reagir somente a alterações aceitas no estado autenticado da sala, não ao payload rejeitado. Acrescentar teste de integração com microfone ativo e sync forjado.

### R03 — P1: fechamento do aplicativo não encerra explicitamente a captura

`src-tauri/src/lib.rs:59` desconecta controles virtuais e chama `std::process::exit(0)`. Não chama a parada da captura. O worker em `src-tauri/src/media.rs` é um processo filho; sua limpeza depende de `stop`/`Drop`, e `process::exit` não executa esses destrutores.

Há risco de `gst-launch` continuar capturando após fechar a interface. É uma conclusão do fluxo de código; não foi executada captura real para observar processo órfão. Encerrar a sessão antes da saída e garantir a morte do filho quando o processo pai terminar, inclusive em falhas.

### R04 — P2: receptores RTP não estão restritos ao loopback

`src-tauri/src/webrtc_bridge.rs:349` configura `udpsrc` com porta e caps, sem `address`. O `gst-inspect-1.0` instalado confirmou o padrão `0.0.0.0`. Enviar para `127.0.0.1` no worker não restringe o endereço de escuta do receptor.

Assim, o RTP local sem autenticação pode ficar acessível por outras interfaces, dependendo do firewall. Definir explicitamente o endereço de loopback. A alocação em `media.rs:486` também libera o socket após escolher uma porta, antes da abertura pelo receptor: ela não reserva a porta, permitindo colisões ou ocupação por outro processo.

### R05 — P2: AV1 usa propriedade inexistente no payloader

`src-tauri/src/webrtc_bridge.rs:105` aplica `config-interval` indiscriminadamente. O pipeline AV1 em `src-tauri/src/media.rs:638` também inclui `config-interval=1`. A inspeção do `rtpav1pay` instalado não apresenta essa propriedade. O caminho pode falhar na criação do pipeline ou na atribuição da propriedade, embora o teste que apenas verifica a construção dos argumentos passe.

Separar as propriedades por codec e testar a criação real de pipelines sintéticos para cada codec anunciado. O caminho AV1 atual usa `d3d11download` e `svtav1enc`; não é codificação AV1 integralmente na GPU.

### R06 — P2: gamepad nativo usa detecção diferente do restante do desktop

`js/coop.js:56` exige `window.__TAURI__.core.invoke`. O adaptador em `js/desktop.js:16` também suporta `__TAURI_INTERNALS__`, mas o co-op não o utiliza; a configuração atual não habilita o global público do Tauri. Nesse ambiente, o caminho nativo de gamepad fica inacessível apesar de a captura funcionar.

Mesmo quando o global existe, a aprovação chama `plug_virtual_gamepad` sem aguardar sucesso e ignora erros, anunciando `gamepad: true` pela presença do Tauri (`coop.js:410–430`). Centralizar o acesso no adaptador desktop e anunciar disponibilidade somente após confirmar o driver e o dispositivo virtual.

### R07 — P2: broadcast sem filtro de autenticação e sem deduplicação

`js/app.js:1359` envia a todos os `connectedViewers`, inclusive conexões aguardando PIN. O envio a `watchingHosts` não respeita `excludePeerId`; depois há outro broadcast por RoomManager. Mensagens de chat e sinais podem retornar pela malha e ser duplicadas ou retransmitidas repetidamente.

Os exports `isDuplicateMessage` e `seenMessageIds` já não existem no módulo, mas `tests/audit-remediation.test.js:5` continua importando ambos, e a preparação do teste chama `seenMessageIds.clear()`. Essa inconsistência é verificável estaticamente; a suíte atual não foi executada com sucesso. Restaurar o contrato de comportamento e a deduplicação, sem apenas remover as asserções.

### R08 — P2: inicialização do PeerJS ainda pode anteceder o TURN

`js/app.js:1095` inicializa PeerJS de forma síncrona com a configuração disponível. `fetchIceServersFromApi` é iniciado separadamente em `app.js:4010`. Não há espera pela resolução das credenciais antes de criar o Peer. Isso pode manter conexões com a configuração de fallback mesmo quando o endpoint responde depois.

O endpoint agora exige token em produção, uma melhora. Porém o token é um segredo compartilhado de implantação, sem emissão individual com expiração no fluxo revisto. No desktop, o endpoint relativo também precisa apontar para um serviço realmente disponível fora da origem local Tauri. Validar duas redes distintas com relay obrigatório, não apenas conexões locais.

### R09 — P2: trilha negociada não prova recepção de mídia

`js/native-webrtc.js` conclui `createStream` ao observar trilhas de áudio/vídeo, que podem existir a partir do SDP antes de chegar mídia. Os contadores de frames são registrados posteriormente, mas não condicionam o sucesso. Falha de conexão fecha a ponte; não encerra diretamente o worker de captura.

O subprocesso tem stdout/stderr descartados e uma verificação inicial breve; não há monitoramento contínuo de sua saúde. Também há esperas de promises GStreamer sem prazo em `webrtc_bridge.rs:340`. Tratar primeiro frame decodificado, perda do worker e timeout de negociação como estados explícitos, propagados até a interface e a limpeza da sessão.

### R10 — P2: flush do replay escuta evento incorreto

`js/clipping.js:165` escuta `ondataavailable`; o nome do evento é `dataavailable`. Assim o flush normalmente depende do timeout de 120 ms, sem garantia de receber o último bloco. `exportClip` ainda solicita outro bloco e segue sem esperar sua entrega. Pode faltar o final mais recente do replay.

O registro independente por origem agora existe (`ClipRecorderRegistry`) e a aplicação passa IDs por stream: isso é um avanço real. Ainda é necessário validar exportação longa com keyframes espaçados, timestamps e corte do primeiro cluster, além da fixture curta.

## Captura nativa versus plano

Fluxo implementado:

```text
Janela/monitor → WGC/D3D11 → encoder → RTP/UDP
  → GStreamer webrtcbin → WebRTC local → MediaStream no WebView
  → PeerJS → espectador remoto
```

Há seleção nativa e um backend real; não é mais apenas um marcador de disponibilidade. A transmissão externa, porém, ainda passa pelo MediaStream do WebView e pelo PeerJS, com decodificação local e nova codificação para envio. Não equivale ao envio nativo direto a cada espectador previsto como objetivo de desempenho. Não foram medidos FPS, latência, CPU/GPU, consumo por espectador ou sincronismo A/V nessa revisão.

O caminho desktop nativo evita depender do seletor de `getDisplayMedia` quando funciona. Isso não constitui comprovação visual de ausência do seletor em todos os fluxos: é necessário validar janela, monitor, cancelar/reiniciar, fonte fechada, áudio e retorno de erro no executável instalado.

## Anticheat, dependências e empacotamento

- A captura examinada usa APIs do Windows/GStreamer. Não encontrei nesse caminho necessidade de injetar DLL no processo do jogo. Isso não comprova compatibilidade com Vanguard nem garante captura de conteúdo protegido.
- O gamepad adiciona uma dependência separada de driver de kernel, ViGEmBus. O fornecedor informa que o projeto e bibliotecas foram arquivados e não receberão atualizações: [comunicado oficial](https://docs.nefarius.at/projects/ViGEm/End-of-Life/). Não há evidência nesta revisão para afirmar que ele esteja bloqueado pelo Vanguard ou cause banimento.
- `tools/install-vigem.ps1` baixa e executa o instalador sem verificar explicitamente hash ou assinatura Authenticode. A descrição do script não substitui verificação. O driver deve ser opcional e sua instalação separada da captura.
- `beforeDevCommand` e `beforeBuildCommand` chamam a preparação de GStreamer, incluindo SDK. Há efeitos de download/instalação no fluxo de build. Separar provisionamento de dependências e build reproduzível facilitaria CI e diagnóstico.
- O runtime local existe; o build copiou 146 DLLs para o perfil debug. A inspeção/testes produziram aviso de dependência ausente de `gstpython.dll`, embora os 13 testes Rust tenham passado. Revisar plugins realmente necessários no pacote e validar instalação limpa sem SDK instalado.
- A CSP deixou de ser nula, e `alwaysOnTop` está desativado por padrão. Ainda há `unsafe-inline` e origens amplas: são melhorias parciais, não fechamento completo da superfície web.

## Validação desta revisão

| Verificação | Resultado | Alcance |
| --- | --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --offline --lib` | 13 passaram | Mapeamento de gamepad, argumentos de pipelines, capabilities, negociação e RTP sintético |
| Testes Python de pendências | 4 passaram | Autenticação e liberação de entradas, incluindo failsafe; módulos de entrada simulados |
| `cargo clippy --locked --offline --all-targets -- -D warnings` | Passou | Compilação/análise estática Rust |
| `cargo fmt --check` | Falhou | Formatação em capture.rs, media.rs e webrtc_bridge.rs |
| Suíte JavaScript atual | Sem resultado | Primeira tentativa: `spawn EPERM`; execução ampliada rejeitada por revisão automática por limite de uso |
| Inspeção dos plugins locais | Executada | Default de bind UDP e propriedades do payloader AV1 |
| Captura real, áudio, gamepad físico, Vanguard e instalador limpo | Não executados | Permanecem validações de aceitação |

Partes do runtime/comandos Tauri são excluídas por `cfg(not(test))`. Os testes Rust aprovados não cobrem fechamento da janela, autorização JS, entrega real de frames ou a ligação de todos os comandos ao aplicativo. A disponibilidade de um plugin também não comprova que determinado codec funciona no hardware do usuário.

## Ordem recomendada para conclusão

1. Corrigir R01/R02/R07 e restaurar testes de autorização, identidade e mensagens duplicadas, incluindo a integração app/RoomManager.
2. Corrigir encerramento, bind UDP, reserva de portas e propagação de falhas; testar filho encerrado após fechar o aplicativo.
3. Corrigir AV1 e gamepad; executar pipelines sintéticos por codec e validar o contrato desktop com os globals reais do Tauri.
4. Corrigir TURN e replay; executar a suíte JavaScript e repetir somente os testes afetados pelas correções.
5. Validar executável instalado com janela/monitor, áudio por processo/sistema, primeiro frame, troca de fonte e sessão longa. Medir envio remoto em duas redes e custo de múltiplos espectadores.
6. Decidir explicitamente se a ponte pelo WebView atende ao produto ou se será concluído o envio WebRTC diretamente nativo. Manter a instalação de driver de controle independente.

Ferramentas úteis são as que fecham essas lacunas: estatísticas WebRTC de frames/bitrate/RTT, bus/logs GStreamer com identificador de sessão, testes sintéticos por codec e uma CI Windows que compile, teste e verifique o pacote sem depender do SDK do desenvolvedor. Adicionar ferramentas não substitui os controles de autorização e ciclo de vida acima.
