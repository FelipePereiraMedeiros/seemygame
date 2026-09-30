# Situação da modularização — verificação de 30/09/2026

## Resultado atual

A migração segue **parcial**. As páginas carregam entrypoints dedicados, e este reparo integrou os fluxos que estavam comprovadamente desconectados: habilitação do botão de transmissão após o PeerJS abrir, recebimento de chat na sessão, conexão/admissão da Room pelo coordenador e PIN, malha de dados entre convidados, voz/Co-op e bindings de lousa, ping, reações e soundboard. As factories agora criam engines próprios e o ciclo de sessão descarta esses recursos.

Isso não conclui a modularização arquitetural. `js/app.js` continua contendo implementação substancial; as extrações de política de áudio, engines maiores, CSS, Rust e infraestrutura E2E permanecem pendentes. O teste de navegador existente cobre a interface da lousa, mas não comprova rede PeerJS real, captura nativa ou equivalência de todos os recursos.

## Verificações executadas após as correções

- `npm test`: **71 arquivos e 714 testes passaram**.
- `npm run test:smoke`: **14 imports ESM passaram** no workspace atual.
- `npm run test:e2e:whiteboard`: aprovado em Chrome para Room e Streamer; verificou abrir/fechar, canvas interativo e botões da lousa.
- `node --check` nos módulos alterados e `git diff --check`: aprovados.
- A suíte Vitest exibiu os avisos já conhecidos de `canvas.getContext()` e navegação não implementados pelo JSDOM.

Esses resultados são de arquivos locais, inclusive ainda não rastreados. Nenhum commit, push ou deploy foi feito.

As correções, dependências ESM, testes e estes dois relatórios estão em staging para inclusão no próximo commit. As alterações separadas de gamepad e os documentos de auditoria/inventário já existentes no workspace ficaram fora do staging. Até haver commit, o `HEAD` e um clone limpo continuam sem esses módulos.

## Frentes concluídas neste reparo

1. O botão `#stream-btn` é habilitado quando o PeerJS registra o Streamer.
2. A Room tenta registrar o ID determinístico do coordenador; se ocupado, entra com ID aleatório. Conexões usam `RoomManager` para admissão, PIN, sincronização, presença e mesh. O modal de PIN reenvia o pedido ao coordenador.
3. Chat, voz, Co-op e mensagens de plugins são compostos no dispatcher da sessão. A voz escolhe o peer que inicia cada chamada por ordem de ID para evitar chamadas duplicadas.
4. Wrappers das features recebem engines próprios. Canvas, dock de reações e canvas de ping são vinculados; DiscordUI passa callbacks de soundboard, reações, lousa, stream, tuning e saída.
5. Como os entrypoints ainda mantêm estado de módulo, `SessionContext` impede duas instâncias concorrentes do mesmo tipo de página e libera a chave no `dispose()`.

## Situação dos achados

| Achado | Situação atual |
| --- | --- |
| M01 — imports e dependências | **Parcial** — imports locais e smoke passam; novos módulos ainda precisam estar rastreados para que um checkout limpo os inclua. |
| M02 — contratos/paridade | **Parcial** — os bloqueios desta revisão foram ligados; paridade integral das páginas ainda não foi comprovada. |
| M03 — inicialização única | **Parcial** — páginas usam entrypoints e cada tipo de página bloqueia init concorrente; `app.js` ainda conserva composição/execução legada. |
| M04 — composição/estado | **Parcial** — managers de plugins são por sessão e init concorrente é barrado; chat/voz e outros estados de módulo ainda são compartilhados. |
| M05 — concentração em `app.js` | **Pendente** — extração ampla não executada. |
| M06 — domínio/UI | **Resolvido localmente** — validações puras já foram extraídas. |
| M07 — protocolo/admissão/deduplicação | **Parcial** — RoomManager, AdmissionGate e dispatcher da sessão estão integrados; envelopes e validação canônica não cobrem todo o transporte. |
| M08 — rejeições assíncronas | **Resolvido** nos barramentos/dispatcher conforme testes existentes. |
| M09 — ciclo de vida | **Parcial** — descarte de engines/UI e guarda de init foram ampliados; faltam teardown assíncrono e propriedade de todos os recursos globais. |
| M10 — funcionalidades em plugins | **Parcial** — UI e engines principais agora são compostas; clipping e funcionalidades avançadas ainda não têm paridade completa. |
| M11 — política de áudio | **Pendente** — consumidores e propriedade de AudioContext ainda não foram migrados integralmente. |
| M12 — engines/agregadores | **Pendente** — `app.js`, Voice, Coop, Room e engines maiores continuam a precisar de separação. |
| M13 — CSS | **Pendente** — extração não executada. |
| M14 — HTML/navegação | **Parcial** — entrypoints, Room e UI da lousa funcionam; navegação e recursos não têm equivalência global demonstrada. |
| M15 — Rust | **Pendente** — modularização nativa não executada; nenhum check nativo foi repetido neste reparo. |
| M16 — caminhos reais | **Parcial** — Vitest, smoke e E2E da lousa passaram; conexão multi-peer real não foi comprovada por este E2E. |
| M17 — infraestrutura E2E | **Pendente** — harnesses não foram separados nem ampliados para os fluxos completos. |
| M18 — build/config/documentação | **Parcial** — status/documentação corrigidos e smoke disponível; rastreamento dos módulos e validação de checkout limpo ainda precisam ser concluídos. |

Consulte [verificacao-conclusao-modularizacao-2026-09-30.md](verificacao-conclusao-modularizacao-2026-09-30.md) para detalhes dos bloqueios, critérios e evidências.
