# Verificação da modularização — 30/09/2026

## Veredito

**A migração continua parcial.** Este reparo fechou os bloqueios funcionais reproduzíveis nos entrypoints Streamer, Viewer e Room e ligou os plugins principais aos controles da página. A conclusão arquitetural ainda não pode ser declarada: `app.js`, política de áudio, engines grandes, CSS, Rust e os harnesses E2E ainda precisam da separação planejada. Os testes de navegador existentes cobrem a interface da lousa, não uma sessão PeerJS entre navegadores nem os recursos nativos.

O documento de status foi corrigido para registrar esse limite. Consulte a tabela de 18 achados abaixo; ela substitui afirmações anteriores de conclusão total e paridade integral.

## Correções feitas

1. **Streamer:** `#stream-btn` é habilitado quando o PeerJS abre; a composição de sessão processa chat recebido, voz e mensagens Co-op.
2. **Room:** tenta registrar o Peer ID determinístico do coordenador e usa ID aleatório se ele já estiver ocupado. Conecta DataConnections ao `RoomManager`, envia pedido de entrada, chave/PIN e identidade de sessão, atende o modal de PIN, sincroniza membros e inicia a malha direta entre convidados. Chamadas recebidas exibem streams de sala e voz; o dock permite captura de tela do navegador.
3. **Viewer/Streamer/Room:** handlers de chat, voz e Co-op foram incluídos nos dispatchers de sessão. A chamada de voz é iniciada pelo peer com menor ID para evitar chamadas simultâneas duplicadas.
4. **Plugins:** factories criam Whiteboard, Soundboard, Tactical Ping, Reactions e Clipping managers próprios. Teardown libera canvas, render loop, AudioContext, gravação e reações transitórias. Os entrypoints vinculam canvas de lousa, canvas de ping, dock de reação e callbacks de Soundboard, reação, lousa, stream, tuning e saída.
5. **Whiteboard:** a sessão liga ferramentas, histórico, importação/cola/arrasto de imagem, exportação PNG, compartilhamento no chat, sync P2P e controles de abrir/fechar.
6. **Estado:** `SessionContext` rejeita init concorrente do mesmo entrypoint e libera a chave em `dispose()`. Os entrypoints ainda têm estado de módulo e managers compartilhados fora das factories, portanto não oferecem isolamento completo entre sessões do mesmo realm.

## Validação executada após as correções

| Verificação | Resultado | Limite |
| --- | --- | --- |
| `npm test` | **71 arquivos, 714 testes passaram** | A suíte executa em JSDOM; os avisos de canvas e navegação não implementados persistem. |
| `npm run test:smoke` | **14 imports ESM passaram** | Vinculou os arquivos presentes no workspace; só prova um checkout limpo depois de incluir as novas dependências no commit. |
| `npm run test:e2e:whiteboard` | **Aprovado em Chrome** para Room e Streamer | Verificou abrir/fechar a lousa, controles e canvas interativo. Não valida rede multi-peer, captura nativa ou todas as features. |
| `node --check` | **Aprovado** nos módulos alterados | Verificação sintática. |
| `git diff --check` | **Aprovado** | Verificação de whitespace do diff local. |

`npm run native:smoke` não foi repetido nesta etapa; a aprovação citada no relatório anterior é evidência histórica, não valida as correções atuais nem a modularização Rust.

As dependências ESM, correções, testes e relatórios deste reparo estão staged. Isso corrige a ausência no índice local; um clone do `HEAD` só as receberá após o commit. Alterações separadas de gamepad, `.agents/` e auditoria/inventário preexistentes permaneceram fora do staging.

## Pendências por achado

| Achado | Situação | Evidência/pendência |
| --- | --- | --- |
| M01 — imports/dependências | **Parcial** | Smoke ESM passa localmente. `session-context`, factories, protocolo, validadores e navegação precisam entrar no commit; staged não equivale a checkout limpo. |
| M02 — contratos/paridade | **Parcial** | Botão, chat recebido, PIN/entrada Room, voz e controles de plugins foram conectados. Equivalência funcional de todas as páginas ainda não foi exercitada. |
| M03 — inicialização única | **Parcial** | HTML usa entrypoints; guarda previne dois inits simultâneos do mesmo papel. `app.js` ainda contém composição legada. |
| M04 — composição/estado | **Parcial** | Factories possuem engines e o init concorrente é recusado. Estado e managers legados de chat/voz/Co-op permanecem fora do contexto. |
| M05 — concentração em `app.js` | **Pendente** | O módulo ainda mantém implementações grandes de sessão, rede, mídia e UI. |
| M06 — domínio/UI | **Resolvido localmente** | Validadores puros já estão em módulos compartilhados. |
| M07 — protocolo/admissão/deduplicação | **Parcial** | `RoomManager`, `AdmissionGate` e dispatchers estão usados. Envelopes canônicos e validação ainda não foram adotados por todo transporte. |
| M08 — rejeições assíncronas | **Resolvido** | Coberto pelas melhorias anteriores de EventBus/dispatcher e testes existentes. |
| M09 — ciclo de vida | **Parcial** | Disposição de plugins e UI melhorou; falta ciclo assíncrono e ownership de recursos globais e conexões em todos os fluxos. |
| M10 — funcionalidades completas em plugins | **Parcial** | UI/canvas e managers principais entram na composição; clipping, ferramentas avançadas e paridade integral ainda faltam. |
| M11 — política de áudio | **Pendente** | Consumidores de áudio e ownership de contextos/nós não foram migrados integralmente. |
| M12 — engines/agregadores | **Pendente** | Separação ampla de Room, Voice, Co-op, Whiteboard, Clipping, Gamepad e agregadores ainda não foi feita. |
| M13 — CSS | **Pendente** | Extração não executada. `split-css.mjs` requer cuidado com offsets antigos. |
| M14 — HTML/navegação | **Parcial** | Entry scripts, navegação Room e lousa funcionam; fluxo completo e todos os recursos ainda não têm paridade demonstrada. |
| M15 — Rust | **Pendente** | Extração nativa não executada. |
| M16 — caminhos reais | **Parcial** | Testes unitários/integrados e E2E da lousa passaram; falta cenário real de entrada, PIN, reconexão, voz e mídia entre peers. |
| M17 — infraestrutura E2E | **Pendente** | Harnesses de rede/desktop não foram separados nem ampliados para cobrir os fluxos completos. |
| M18 — build/config/documentação | **Parcial** | Documentação e smoke atualizados. Falta confirmar dependências num clone limpo e formalizar CI/gates. |

## Critério para declarar conclusão

1. Rastrear e commitar as dependências ESM da migração e demonstrar `test:smoke` em checkout limpo.
2. Testar Room/Streamer/Viewer com peers reais no navegador: entrada, PIN inválido/válido, chat, voz, Co-op, streams, desconexão, reconexão e teardown.
3. Validar captura e periféricos nativos aplicáveis em Tauri/Windows.
4. Concluir ou replanejar formalmente M05, M10–M13, M15 e M17; não usar testes JSDOM/mock como evidência E2E real.
5. Atualizar a documentação após essas etapas, mantendo unitário, integração mockada e E2E de navegador claramente separados.

Não houve commit, push ou deploy nesta tarefa.
