# Correção das pendências — 2026-10-03

As sete pendências identificadas na [revalidação](C:/Users/Diogo/SeeMyGame/docs/revalidacao-achados-2026-10-02.md) foram corrigidas no checkout baseado em `bb85f90` e registradas neste repositório.

| Achado | Correção |
|---|---|
| A03 | Uma chamada com RTCPeerConnection em `new` é preservada durante a negociação. O handshake `open → REQUEST_STREAM` cria apenas uma chamada; fechar a conexão de dados continua encerrando a mídia. |
| A10 | Identidade/papel de mensagens diretas são definidos pela sessão. Mensagens recebidas não podem declarar-se como sistema. A Room usa o cadastro de membros; o Streamer usa os slots Co-op atribuídos. O Viewer preserva o autor sanitizado de mensagens encaminhadas exclusivamente pelo host acompanhado com conexão aberta. A Room usa sua malha direta para chat. |
| A11 | A lousa recebe snapshots completos em staging e aplica o documento somente após os batches, imagens e marcador de fim. Imagens existentes são substituídas, elementos obsoletos removidos e a ordem das camadas preservada. Snapshots vazios também removem conteúdo antigo. Imagens retransmitidas pelo host continuam fragmentadas. |
| A14 | O servidor normaliza barras invertidas antes de validar caminhos, bloqueia caminhos ocultos e streams alternativos do Windows, e serve apenas páginas públicas e diretórios `css`/`js`. Arquivos nativos, metadados do pacote e relatórios ficam fora da superfície servida. |
| S1 | Chunks exigem índices/totais inteiros, metadados consistentes e chave por peer/transferência. Há limites de bytes antes de armazenar/concatenar, cota de transferências simultâneas e expiração ativa de 60 segundos. Recursos e timers são liberados ao descartar a sessão. |
| S2 | Drag, resize, criação, update e redo usam o mesmo método de histórico, limitado a 50 snapshots. O undo preserva o estado anterior ao gesto. |
| S5 | Streamer e Room compartilham um limiter com cinco falhas por peer e bloqueio de 30 segundos, preservado após desconectar. Um orçamento de 50 falhas por janela também cobre rotação de IDs. A estrutura de falhas possui cota e expiração. |

## Código e testes

- [Transferências da lousa](C:/Users/Diogo/SeeMyGame/js/whiteboard/transfer.js) e [plugin](C:/Users/Diogo/SeeMyGame/js/plugins/whiteboard-plugin.js).
- [Identidade e relay do chat](C:/Users/Diogo/SeeMyGame/js/protocol/session-handlers.js), com identidade injetada pelas três factories de sessão.
- [Limiter de PIN](C:/Users/Diogo/SeeMyGame/js/protocol/pin-attempt-limiter.js), utilizado por `AdmissionGate` e `RoomManager`.
- [Servidor público local](C:/Users/Diogo/SeeMyGame/tools/serve.mjs).
- [22 novos testes de regressão](C:/Users/Diogo/SeeMyGame/tests/audit-pendencias-regression.test.js), além das assertions reforçadas para A03/A14 no [arquivo anterior](C:/Users/Diogo/SeeMyGame/tests/audit-findings-regression.test.js).
- [E2E de sessões ampliado](C:/Users/Diogo/SeeMyGame/tests/e2e-sessions.mjs): dois Viewers verificam autoria de chat encaminhado; a Room sincroniza uma PNG válida maior que 256 KiB por DataChannels reais, removendo conteúdo obsoleto e preservando camadas.

## Resultados de validação

| Verificação | Resultado |
|---|---|
| Regressões da auditoria + novas pendências + modularização | **43 testes aprovados** na execução dirigida final. Inclui os 22 novos. |
| Suíte completa no ambiente padrão | **1014 aprovados / 2 falhas**, em 100 arquivos. As únicas falhas foram os dois testes de replay que executam FFmpeg. |
| Dois testes de replay, repetidos com FFmpeg funcional | **2 aprovados**. Foi usado `FFMPEG_BIN` apontando para a instalação WinGet existente, com acesso autorizado fora do sandbox. Nenhum teste foi ignorado. |
| Parsing/imports, HTML, CSS e smoke | Passaram: 165 módulos autorais e 429 imports/exports; smoke de 159 módulos sem iniciar recursos de página. |
| `npm run build:dist` | Passou, executado separadamente. |
| E2E de sessões, incluindo os novos cenários de chat e snapshot | Passou. |
| E2E da lousa | Passou. |
| `git diff --check` | Passou. |

O `verify` padrão ainda selecionou o FFmpeg problemático do ambiente e encerrou antes do build. Os dois testes passaram numa execução separada com o binário correto; **não foi feita uma segunda execução completa de `verify` com esse override**. Para reproduzir a validação de replay, definir `FFMPEG_BIN` para um FFmpeg funcional com permissão de execução. O problema do binário de ambiente não exigiu alterações nos testes de replay nem na aplicação.

A cota compartilhada de staging da lousa é de 16 MiB por sessão, com até 25 reassemblies e 25 snapshots pendentes. Transfers inválidas, incompletas ou acima dessa cota são descartadas; snapshots incompletos preservam o documento visível. O limite existente de 2,5 milhões de caracteres por imagem continua aplicado. O marcador de fim e a ordem de elementos pertencem ao novo protocolo de snapshots; a recepção de batches regulares do protocolo anterior continua disponível, com suas limitações anteriores de aplicação progressiva.

Logs locais, ignorados pelo Git: [suite/verify](C:/Users/Diogo/SeeMyGame/docs/correcao-pendencias-verify.log), [regressões dirigidas](C:/Users/Diogo/SeeMyGame/docs/correcao-pendencias-targeted.log), [replay com FFmpeg funcional](C:/Users/Diogo/SeeMyGame/docs/correcao-pendencias-replay.log), [E2E de sessões](C:/Users/Diogo/SeeMyGame/docs/correcao-pendencias-sessions.log), [E2E da lousa](C:/Users/Diogo/SeeMyGame/docs/correcao-pendencias-whiteboard.log) e [build](C:/Users/Diogo/SeeMyGame/docs/correcao-pendencias-dist.log).

Os relatórios e sondas anteriores permanecem como histórico do comportamento defeituoso. Para verificar as correções, executar os testes de regressão, cujas assertions agora exigem o comportamento correto.
