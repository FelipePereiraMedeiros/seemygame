# Revalidação das pendências — 15/09/2026

Comparação dos arquivos atuais de `G:\SeeMyGame` com `verificacao-implementacao-2026-09-14.md`, a auditoria original e o plano de captura. Inclui alterações locais não commitadas.

**Resultado: houve correções substanciais, mas as pendências não estão totalmente resolvidas. Captura nativa continua sem implementação de mídia.**

Nenhum código de produção foi alterado nesta revisão. O build estático foi reconstruído com `KILL_DESKTOP=false` e sem `--kill`. Provas de conexão, mídia e input usaram objetos simulados; nenhum jogo, microfone, Companion ou transmissão real foi iniciado.

## Verificações executadas

| Verificação | Resultado |
|---|---|
| `npm test` | **331 testes passaram**, 26 arquivos |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --offline --all-targets -- -D warnings` | **Passou**, incluindo compilação dos alvos verificados |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | **Passou**; a pendência anterior foi corrigida |
| Build estático | **Passou**, sem encerrar processos |
| Provas adicionais Node/Python | Resultados abaixo |

Persistem avisos de canvas/navegação não implementados no jsdom. Esses testes não validam reprodução real de clipes, GPU, TURN entre máquinas ou compatibilidade com Vanguard.

## Comparação com os nove achados da última revisão

| Achado anterior | Estado atual | Evidência |
|---|---|---|
| R01 — Captura nativa ausente | **Pendente** | `capture.rs` continua com `available: false` e retorno obrigatório de erro. Agora a interface informa a indisponibilidade antes de iniciar |
| R02 — Autorização de sala contornável | **Provas anteriores corrigidas** | Confirmação forjada, entrada direta com PIN errado em guest e sync forjado no master foram rejeitados nas novas provas |
| R03 — Destino de voz escolhido no payload | **Corrigido no caminho examinado** | `HOST_VOICE_ACTIVE` usa a conexão de origem autorizada como destino; não usa mais o destino arbitrário do payload |
| R04 — Companion sem pareamento/origins incorretas | **Corrigido no escopo anterior** | Token exigido no startup, confirmação `AUTH_OK` no JS, domínios exatos e origem desktop reconhecida |
| R05 — Liberação insegura de input | **Parcial** | Reset e fechamento do socket foram adicionados ao fim do co-op; watchdog existe. A liberação ainda falha quando a API de input rejeita keyUp/mouseUp |
| R06 — Ponte e transporte nativos ausentes | **Pendente** | Continua dependência de `__SEEMYGAME_NATIVE_CAPTURE__.createStream`, sem implementação do pipeline nativo |
| R07 — Serialização/import de eventos | **Corrigido no contrato examinado** | `desktop.js` normaliza snake_case; import npm não resolvido foi substituído por chamadas ao plugin de eventos. Execução real no WebView não foi validada |
| R08 — Cancelamento de captura | **Parcial** | Cancelamento simples corrigido; uma conclusão antiga ainda interfere numa nova captura com o mesmo provedor |
| R09 — Autorização da sala versus legado | **Corrigido no caminho examinado** | Autorização centralizada por sessão e handlers de PIN integrados. Não equivale a validação real de uma sala entre máquinas |

## Provas antigas repetidas

Executadas com os módulos atuais de sala/captura:

```json
{
  "forgedAcceptance": { "authorized": false, "inMesh": false },
  "guestWrongPinAuthorized": false,
  "forgedSyncInsertedMember": false,
  "cancelDuringStart": { "error": "CaptureCancelledError", "state": "idle" }
}
```

Com resposta Rust simulada contendo `session_id: "native-123"`, o frontend agora envia corretamente esse ID tanto a `set_native_capture_audio_mode` quanto a `stop_native_capture`.

A função real de validação de origem do Python, executada isoladamente por AST, retornou:

| Origem | Aceita? |
|---|---|
| `https://evilseemygame.com` | Não |
| `https://evilseemygame.pages.dev` | Não |
| `http://tauri.localhost` | Sim |
| Sem Origin | Não |

## Pendências que ainda impedem concluir o trabalho

### 1. Captura nativa: falta o recurso principal

[capture.rs:75](G:/SeeMyGame/src-tauri/src/capture.rs:75) continua fixando `available: false`. Enumerar fontes, normalizar IDs e desativar botões indisponíveis melhora a interface, mas não captura quadros. Faltam worker WGC/WASAPI, encoder, transporte WebRTC nativo, runtime empacotado e testes ponta a ponta.

O primeiro marco do plano — selecionar janela/monitor e enviar vídeo a um navegador remoto — ainda não foi entregue. Instalar GStreamer sozinho não completa o código ausente.

### 2. Companion: registro preservado não significa tecla liberada

`release_all()` agora preserva as teclas cuja liberação falhou, corrigindo a perda do registro anterior. Entretanto, repete `pyautogui.keyUp`/`mouseUp` com failsafe ativo e não oferece uma via de liberação eficaz quando essas chamadas são rejeitadas.

Na prova com API simulada que rejeita keyUp no canto da tela:

```text
release_all() = False
pressed_keys = {'w'}
```

O ramo de teclado ainda contém `except Exception: pass`, absorvendo também a exceção de failsafe. O tratamento externo não revoga incondicionalmente a sessão, e tentativas no `finally` podem falhar pelo mesmo motivo. O timeout de 30 segundos não garante liberação física.

**Ainda requer correção antes de considerar o pânico confiável.** A prova não pressionou nenhuma tecla real.

### 3. Cancelar e reiniciar: a conclusão antiga apaga o estado da nova sessão

Na camada `CaptureManager`, reproduzi esta sequência com `BrowserCaptureProvider` real e `getDisplayMedia` simulado:

1. Iniciar A e deixá-la pendente.
2. Parar A.
3. Iniciar B e concluir B normalmente.
4. Só então resolver a Promise antiga de A.

Resultado:

```json
{
  "finalState": "idle",
  "session": null,
  "currentTrackStopped": false,
  "obsoleteTrackStopped": true
}
```

O manager perde B, embora a track de B continue ativa. O problema está na reutilização do mesmo provedor: a conclusão antiga chama `providerInstance.stop()` e limpa o estado pelo objeto do provedor, sem preservar a geração atual. O bloqueio adicional de início em `app.js` limita algumas interações da UI; esta prova demonstra uma falha na abstração, não uma reprodução manual pela interface.

### 4. Clipes: melhoria de tracks, mas formato e múltiplos vídeos permanecem pendentes

O recorder agora inicia após anexar o microfone, usa tracks isoladas, trata erros e conserva o primeiro chunk. Essas melhorias são reais.

Entretanto, [clipping.js:89](G:/SeeMyGame/js/clipping.js:89) conserva o primeiro chunk inteiro e descarta blocos intermediários; a exportação apenas concatena os restantes em um `Blob`. Não há segmentação/remux com validação de keyframes e timestamps. Não considero demonstrada a validade de um arquivo dos últimos 30 segundos após longa gravação.

Além disso, `app.js` continua usando um único `clipRecorder` para streams locais/remotas e [ui.js:381](G:/SeeMyGame/js/ui.js:381) encaminha o botão de cada cartão ao mesmo botão global. O clipe de um cartão não está vinculado ao vídeo desse cartão. Não foi reproduzido um arquivo real nesta revisão.

### 5. TURN: controles parciais de consumo

`api/turn.js` ganhou origens permitidas, timeout e limite em memória por IP. Continua sem autenticação de usuário/sessão. Um cliente fora do navegador pode fornecer um Origin permitido; o controle por IP depende de cabeçalhos e da confiança na infraestrutura de proxy. O estado em memória não é uma quota global entre instâncias serverless.

Portanto, o item de proteção das credenciais/consumo não está encerrado pelo CORS e pelo contador local. Nenhuma configuração externa de hospedagem foi inspecionada nesta revisão.

## Outras melhorias confirmadas no código

- CSP deixou de ser `null`, embora ainda permita scripts inline e destinos amplos de conexão.
- Alta prioridade e always-on-top deixaram de ser impostos no startup Rust.
- O listener do ABR recebeu proteção contra inicialização duplicada; há ajustes de alvo/estado por espectador.
- `initPeer()` passou a aguardar obtenção de ICE antes de criar o peer.
- Liberação de co-op envia reset e fecha a conexão com o Companion.
- Gamepad indisponível agora aparece no handshake de capacidades, em vez de ser anunciado como input nativo implementado.
- Foram acrescentados limites de mensagens/membros e convite com chave. Não foi demonstrada identidade criptográfica do coordenador nem esgotados todos os cenários de abuso.

**Decisão:** aprovar as correções confirmadas no seu escopo, mantendo abertas captura/transporte nativos, liberação de input, reinício concorrente, clipes e proteção completa de consumo TURN. Testes reais de mídia e jogos continuam necessários antes de anunciar suporte.

## Implementação após esta revalidação

As pendências que eram implementáveis no checkout foram corrigidas:

- `tools/coop-agent.py` agora revoga a sessão imediatamente no failsafe, preserva o registro de falhas e desativa `FAILSAFE` somente durante `keyUp`/`mouseUp`, restaurando-o em seguida.
- `js/capture.js` usa gerações por operação e descarte por resultado; uma conclusão atrasada não pode parar, limpar ou substituir a captura seguinte.
- `js/clipping.js` passou a manter um `ClipRecorder` por fonte. Quando o cabeçalho WebM ficou fora da janela, a exportação preserva o cabeçalho e remove o `Cluster` antigo antes de montar o arquivo.
- `js/app.js` e `js/ui.js` vinculam o botão de cada cartão ao buffer daquele peer/fonte.
- `api/turn.js` exige `TURN_ACCESS_TOKEN` Bearer em produção, inclui `Authorization` no CORS, evita fallback OpenRelay público em produção e mantém o rate-limit limitado em memória. `js/config.js` envia o token de runtime e usa somente STUN como fallback em origem HTTPS de produção.

Após as correções: JavaScript **340/340**, Python **4/4**, `cargo check`, `cargo fmt --check` e `cargo clippy -D warnings` passaram. O construtor do worker Rust também é coberto por testes unitários. Os dois testes Rust de aceitação de mídia real continuam falhando neste checkout por ausência do runtime GStreamer empacotado e da ponte WebRTC.

## Atualização após a implementação do worker nativo

O worker WGC/WASAPI foi implementado em `src-tauri/src/media.rs`. Ele monta
pipelines sem shell para janela/monitor, H.264 (`mfh264enc`) ou HEVC/H.265
(`mfh265enc`), e loopback WASAPI/Opus para áudio do sistema ou do processo.
`windows_list.rs` agora conserva o HMONITOR validado necessário para a fonte de
monitor. O bundle Tauri inclui `native-media` e os scripts
`tools/prepare-native-media.ps1` e `tools/validate-native-media.ps1` automatizam
download, checksum, instalação, inventário e smoke tests.

No checkout atual o runtime não está presente, então as duas provas de
aceitação que exigem mídia real continuam falhando por ausência do runtime. A
ponte `webrtcbin`/SDP/ICE/`MediaStream` também ainda não está implementada; por
isso não foi declarado suporte ponta a ponta nem o seletor nativo foi liberado
silenciosamente.

## Addendum — runtime e ponte implementados

Após esta revalidação, o runtime oficial GStreamer 1.28.7 foi preparado em
`native-media/gstreamer` e o SDK de desenvolvimento ficou em
`.native-media-sdk/gstreamer` (ignorado pelo Git). O worker passou a ser ligado
ao bridge in-process `webrtcbin` por `src-tauri/src/webrtc_bridge.rs`; os
comandos Tauri e `js/native-webrtc.js` negociam SDP/ICE e entregam o
`MediaStream` ao WebView. O build copia as DLLs necessárias para o diretório
do executável, e o hook NSIS repete isso no pós-instalação.

Validações atuais: smoke test GStreamer com os plugins obrigatórios, H.264 e
HEVC aprovados; JavaScript 340/340; `cargo check` e formatação aprovados. A
prova completa com janela/monitor, WebView2, áudio, TURN, reconexão e 20 ciclos
continua sendo uma etapa manual de aceitação, não uma pendência de código já
identificada.
