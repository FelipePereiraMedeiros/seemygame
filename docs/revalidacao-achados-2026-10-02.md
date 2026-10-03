# Revalidação dos achados — 2026-10-02

Registro histórico anterior às correções. Veja o [resultado das correções de 2026-10-03](C:/Users/Diogo/SeeMyGame/docs/correcao-pendencias-2026-10-03.md) para o estado atual das sete pendências.

Repositório avaliado: `SeeMyGame`, branch `main`, commit **`7edb6422429190a18775f6ff6db9573f83beaa1c`**. A avaliação foi retomada depois da atualização solicitada pelo usuário. O checkout estava limpo antes de criar os artefatos desta revisão; nenhum código da aplicação foi alterado.

Referência: [auditoria original](C:/Users/Diogo/SeeMyGame/docs/analise-completa-codigo-2026-10-02.md).

**Resultado: 13 dos 20 achados estão corrigidos no cenário originalmente descrito; 7 estão parcialmente corrigidos.** Há mudanças concretas para todos, mas os testes novos deixam escapar casos relevantes. A11 corrige o late join de uma lousa vazia e introduz uma lacuna de ressincronização de imagens já existentes; essa distinção aparece abaixo.

## Matriz dos 15 achados reproduzidos

| ID | Estado | Evidência e limite da conclusão |
|---|---|---|
| A01 — microfone enviado a peer estranho | Corrigido | O Viewer rejeita e fecha chamadas cujo peer não é o host selecionado nem um host acompanhado com conexão aberta. A regressão exercita a rejeição sem envio do microfone. [viewer-session.js:251](C:/Users/Diogo/SeeMyGame/js/session/viewer-session.js:251). |
| A02 — cascata de conexões na Room | Corrigido | A malha reserva o peer antes de conectar e a admissão evita notificações sem alteração de estado. O E2E atual com três participantes e transmissão para quem entra depois passou. [room-session.js:262](C:/Users/Diogo/SeeMyGame/js/session/room-session.js:262), [admission.js:65](C:/Users/Diogo/SeeMyGame/js/room/admission.js:65). |
| A03 — chamadas de mídia duplicadas | **Parcial** | A guarda preserva chamadas `connected`/`connecting`, mas fecha e substitui uma chamada com RTCPeerConnection em `new`. A sonda criou duas chamadas no handshake `open → REQUEST_STREAM`. [streamer-session.js:325](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:325). |
| A04 — mídia mantida depois de fechar dados | Corrigido | O handler de `close` fecha a chamada ativa antes de removê-la. A sonda atual confirmou todas as chamadas fechadas ao desconectar, inclusive no caso residual de A03. [streamer-session.js:289](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:289). |
| A05 — update inválido da lousa | Corrigido | `updateElement` agora aplica `isSafeWhiteboardElement` antes de persistir. A regressão rejeita `points: [null, null]`. [document.js:128](C:/Users/Diogo/SeeMyGame/js/whiteboard/document.js:128). |
| A06 — tela vazando após falha do microfone | Corrigido | O rollback de captura encerra as tracks adquiridas quando a composição falha. A regressão de permissão negada passou. [room-session.js](C:/Users/Diogo/SeeMyGame/js/session/room-session.js). |
| A07 — parar compartilhamento não limpa Streamer | Corrigido | O listener `ended` do vídeo chama `stopCapture`. A regressão de encerramento pelo navegador passou. [streamer-session.js:391](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:391). |
| A08 — fallback repete ID ocupado | Corrigido | O peer anterior é destruído, o ID customizado é apagado e o retry recebe `forceRandom`. A regressão passou. [streamer-session.js:186](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:186). |
| A09 — botão Co-op sem callback | Corrigido | O cartão do Viewer recebe `onCoopClick`, ligado às operações de solicitar/liberar controle. A regressão confirma a associação do callback. Não é uma validação física do Companion. [viewer-session.js:291](C:/Users/Diogo/SeeMyGame/js/session/viewer-session.js:291). |
| A10 — falsificação da identidade no chat | **Parcial** | O ID direto é vinculado à conexão, mas Room preserva `isSystem`/papel `system`; Streamer ainda preserva papel `system` e nome arbitrário. No relay, o Viewer troca o autor original pelo ID do host. [session-handlers.js:26](C:/Users/Diogo/SeeMyGame/js/protocol/session-handlers.js:26). |
| A11 — imagem grande falha no sync | **Parcial** | A imagem de 300 mil caracteres agora chega em 11 mensagens abaixo da cota e é reconstruída numa lousa vazia. Porém, num full sync só com imagens grandes, a lousa existente não é substituída e imagens com o mesmo ID não são atualizadas. [whiteboard-plugin.js:132](C:/Users/Diogo/SeeMyGame/js/plugins/whiteboard-plugin.js:132). |
| A12 — mesmo nome expulsa membro ativo | Corrigido | A exclusão passou a depender do mesmo `clientSessionId`, em vez de apenas um nome igual. A regressão mantém as duas sessões com o mesmo nome. [message-handlers.js:110](C:/Users/Diogo/SeeMyGame/js/room/message-handlers.js:110). |
| A13 — OpenRelay estático em produção HTTPS | Corrigido | O fallback de origem de produção usa somente STUN. A regressão da origem HTTPS passou. [config.js:79](C:/Users/Diogo/SeeMyGame/js/config.js:79). |
| A14 — servidor expõe arquivos internos | **Parcial** | O bind padrão é loopback e `/.git/HEAD` retorna 403, mas `/%5C.git%5CHEAD` retorna **200 no Windows**. O bloqueio divide apenas por `/`, enquanto o filesystem também reconhece `\`. [serve.mjs:55](C:/Users/Diogo/SeeMyGame/tools/serve.mjs:55). |
| A15 — URI inválida derruba servidor | Corrigido | `/%ZZ` retorna 400; a requisição seguinte a `/` retorna 200 no mesmo processo. A sonda usa um servidor local que ela própria inicia e encerra. [serve.mjs:42](C:/Users/Diogo/SeeMyGame/tools/serve.mjs:42). |

## Matriz dos cinco achados estáticos

| ID | Estado | Evidência e limite da conclusão |
|---|---|---|
| S1 — reassembly sem limites de recursos | **Parcial** | Há cotas de transferências, total de chunks, tamanho por chunk e expiração oportunista. Porém, índices/totais fracionários passam: `total: 1.5` aceitou **256 índices distintos** numa transferência e nunca completa. O mapa também continua indexado apenas por `chunkId`, sem separar peers. [whiteboard-plugin.js:39](C:/Users/Diogo/SeeMyGame/js/plugins/whiteboard-plugin.js:39). |
| S2 — undo ilimitado | **Parcial** | `saveUndoState` limita a 50 snapshots, mas drag/resize ainda fazem `push` direto. **61 drags produziram 61 snapshots**. [input.js:240](C:/Users/Diogo/SeeMyGame/js/whiteboard/input.js:240), [input.js:265](C:/Users/Diogo/SeeMyGame/js/whiteboard/input.js:265). |
| S3 — chamadas de voz da Room não acompanhadas | Corrigido | O handler agora é associado também a `session.messageHandlers`; o caminho de saída acompanha e fecha as chamadas. A regressão de entrar/sair da voz passou. [room-session.js:743](C:/Users/Diogo/SeeMyGame/js/session/room-session.js:743). |
| S4 — thread de fanout vazando se áudio falhar | Corrigido | Ambos os sockets são adquiridos antes do spawn de vídeo; se o spawn de áudio falhar, `running` é desligado e a thread de vídeo é aguardada. Código revisado e compilação sem `cfg(test)` aprovada; sem injeção da falha de spawn nesta revisão. [fanout.rs:27](C:/Users/Diogo/SeeMyGame/src-tauri/src/capture/fanout.rs:27), [fanout.rs:53](C:/Users/Diogo/SeeMyGame/src-tauri/src/capture/fanout.rs:53). |
| S5 — tentativas ilimitadas de PIN | **Parcial** | Streamer fecha após cinco erros e Room após o sexto. Não há cooldown temporal; no Streamer, fechar a conexão chama `revoke`, que apaga as falhas. A sonda reconectou imediatamente o mesmo peer e confirmou contador reiniciado em 1. [messages.js:162](C:/Users/Diogo/SeeMyGame/js/protocol/messages.js:162), [streamer-session.js:289](C:/Users/Diogo/SeeMyGame/js/session/streamer-session.js:289). |

## Pendências que impedem encerrar a auditoria

1. **A14, P2 — bloquear caminhos ocultos depois de normalizar todos os separadores.** O bypass foi confirmado no sistema operacional do projeto. Servir apenas assets públicos também reduz a exposição de arquivos internos; o loopback limita acesso remoto, mas não elimina a leitura local. O servidor da sonda não teve seu bind ampliado e nenhum conteúdo de arquivo interno foi impresso.
2. **A10, P2 — definir identidade/papel do chat a partir de dados autorizados e distinguir relay confiável de autoria direta.** Um membro da Room ainda consegue enviar uma mensagem com aparência de sistema. Remover somente `role: host` no Streamer não cobre `system`/`player2`; sobrescrever indiscriminadamente o autor também quebra mensagens legítimas encaminhadas pelo host.
3. **A03, P1 original — tratar `new` como negociação em andamento.** A correção já fecha a chamada substituída, eliminando o vazamento original, mas ainda aborta uma negociação válida e cria outra. O teste existente fixa o mock em `connected`, por isso não observa o problema.
4. **A11, P2 — preservar semântica de snapshot completo no sync com imagens fragmentadas.** Foi confirmado o caso original de late join corrigido. A pendência é o novo caminho de ressincronização: a imagem existente permanece antiga e um elemento ausente no snapshot continua no receptor. Exigir um início/fim de snapshot e atualizar imagens existentes evita a divergência.
5. **S1, P2 — exigir inteiros finitos e consistência por transferência.** Validar `index`, `total`, identidade do peer e orçamento agregado antes de armazenar chunks. O teste usa apenas 256 chunks pequenos; comprova o crescimento além da cota sem causar exaustão de memória.
6. **S2, P2 — aplicar a mesma política de histórico aos commits de drag e resize.** O limite no método comum não alcança os dois caminhos que gravam diretamente no array.
7. **S5, P2 — preservar falhas/bloqueio por um intervalo após desconectar.** O fechamento de uma conexão já limita uma sequência nela, mas o contador é eliminado no Streamer e não oferece o backoff recomendado pela auditoria original. Novos IDs também exigem uma política com orçamento de tentativas apropriado ao produto.

## Validação executada na versão atual

| Verificação | Resultado |
|---|---|
| `npm run verify` | **Não passou:** 980 testes aprovados e 2 falhas, em 97 arquivos. |
| Parsing/imports, HTML, CSS e smoke dentro de `verify` | Passaram: 163 módulos autorais, 422 imports/exports; smoke de 157 módulos. |
| Suíte nova de regressão da auditoria | Seus 16 testes passaram dentro da suíte completa. Os casos residuais acima não estão cobertos por suas assertions. |
| Falhas JavaScript restantes | Ambas em `pending-replay.test.js`: FFmpeg sai com `3221225785`, inclusive no teste da fixture de controle. O replay não pôde ser validado por essa execução. |
| `npm run build:dist`, executado separadamente | Passou. `verify` encerrou antes desse passo por causa dos testes. |
| `npm run test:e2e:sessions` | Passou: PIN rejeitado/aceito, vídeo decodificado e chat em Streamer/Viewer; Room com três peers e vídeo para late join. |
| `npm run test:e2e:whiteboard` | Passou nos cenários de UI existentes. Não cobre os limites e o sync de imagens usados nas sondas. |
| `npm run native:smoke` | Passou: `cargo check --locked --offline --lib`. |
| `cargo test --locked --offline --lib` | **41 aprovados, zero falhas, 2 ignorados**. Os ignorados continuam dependendo de execução específica de benchmark/captura. |
| `cargo fmt -- --check` | Não passou; continuam diferenças de formatação Rust. Não é uma falha funcional. |
| Sondas complementares | 9 registros de evidência cobrindo sete achados parciais e controles positivos de A04/A11/A15. |

As falhas anteriores dos mocks de canvas, coleta SSH e o timeout do teste de gamepad não ocorreram na execução completa atual. O pipeline ainda não está verde por causa dos dois testes que dependem do FFmpeg.

Não foram executados nesta revalidação os benchmarks físicos nem a matriz distribuída em duas máquinas. Os novos commits de intro e dispositivos de áudio entraram na suíte completa, mas esta revisão tem como escopo fechar os achados anteriores, não substituir uma nova auditoria integral desses recursos.

## Reprodução e artefatos

- [Sondas controladas](C:/Users/Diogo/SeeMyGame/docs/revalidacao-achados-probes.mjs): executar `node docs/revalidacao-achados-probes.mjs`. As assertions descrevem os comportamentos observados, inclusive os defeitos remanescentes; **exit code zero não significa que todos os achados foram corrigidos**.
- [Evidências das sondas](C:/Users/Diogo/SeeMyGame/docs/revalidacao-achados-probes.log).
- [Log completo de verify atual](C:/Users/Diogo/SeeMyGame/docs/revalidacao-achados-atual-verify.log).
- [E2E de sessões](C:/Users/Diogo/SeeMyGame/docs/revalidacao-achados-atual-sessions.log) e [E2E da lousa](C:/Users/Diogo/SeeMyGame/docs/revalidacao-achados-atual-whiteboard.log).
- [Testes Rust](C:/Users/Diogo/SeeMyGame/docs/revalidacao-achados-rust.log), [compilação nativa](C:/Users/Diogo/SeeMyGame/docs/revalidacao-achados-native-check.log) e [formatação](C:/Users/Diogo/SeeMyGame/docs/revalidacao-achados-fmt.log).

Os logs `.log` estão ignorados pelo Git e permanecem disponíveis neste workspace. O relatório original e suas sondas foram preservados como histórico; as assertions antigas não devem ser usadas como testes de sucesso das correções.
