# Situação da modularização — 30/09/2026

A implementação da modularização foi concluída no workspace da branch `dev`, que acompanha `upstream/dev` do Felipe. As 18 frentes da auditoria têm implementação e verificações locais registradas abaixo. Isso descreve conclusão arquitetural; não declara paridade universal em hardware, redes e todos os cenários históricos.

O fluxo de produção é único por página, com serviços e estado criados por factory de sessão. As fachadas antigas preservam a API pública, e o runtime legado só monta explicitamente. Engines, CSS, HTML e Rust foram separados por responsabilidade. Recursos assíncronos, áudio, clipping e transporte nativo passaram a acompanhar o ciclo da sessão.

## Evidências finais

| Verificação | Resultado |
| --- | --- |
| Vitest | 73 arquivos; 724 testes aprovados. |
| Grafo de módulos | 144 módulos autorais; 379 imports/exports literais válidos. |
| Smoke ESM | 139 módulos de serviços importados sem iniciar DOM, rede, áudio ou timers. |
| HTML | Templates e cinco páginas geradas consistentes. |
| CSS | Imports resolvidos; 109 regras main, 132 landing e 449 player na ordem da cascata. |
| E2E Streamer/Viewer | PIN errado recusado, PIN correto aceito, vídeo decodificado e chat por DataChannel real. |
| E2E Room | Três peers, admissão, transmissão decodificada e entrada tardia durante o stream. |
| E2E lousa | Room e Streamer: abrir/fechar, controles, canvas e retorno à sala. |
| Rust | `cargo check` de produção, formatação e 30 testes aprovados. |
| Companion | 5 testes Python aprovados. |
| Distribuição | `npm run build:dist` aprovado. |
| Diff | `git diff --check` aprovado. |

Vitest utiliza JSDOM e ainda emite seus avisos de canvas/navegação não implementados; esses caminhos visuais têm verificações em Chrome. Os testes Rust exercitam pipelines e negociação GStreamer, incluindo RTP, mas não homologam captura de um jogo físico de ponta a ponta.

## Fechamento dos achados

| Achado | Implementação concluída |
| --- | --- |
| M01 — imports/dependências | Dependências declaradas, imports locais verificados e vínculo ESM de todos os serviços. |
| M02 — contratos | APIs públicas e wire format compatíveis; contratos de provider, cartão, telemetria e sala corrigidos e cobertos por regressões. |
| M03 — inicialização | `pages` é o ponto de montagem; entrypoints e fachadas não iniciam página por import. |
| M04 — estado | Factories independentes com chat, voz, Co-op, plugins, áudio e stats próprios. |
| M05 — app | Fachada pequena; comandos extraídos em módulos de sessão, mídia, sinalização, tuning, identidade, UI e features. |
| M06 — domínio/UI | Identificadores, navegação, protocolo e coleta de métricas separados do DOM. |
| M07 — protocolo | Envelope canônico, identidade por salto, admissão, limites e deduplicação por mensagem; Co-op P2P usa o mesmo transporte. |
| M08 — assíncrono | Rejeições contidas no bus/dispatcher e liberações acompanhadas pelo contexto. |
| M09 — ciclo de vida | Abort/cancelamento, cleanup idempotente, liberação tardia, descarte assíncrono e remontagem dos controles. |
| M10 — features | Composição de lousa, som, ping, reações, clipping/editor e transporte nativo; replay selecionado por fonte. |
| M11 — áudio | Escopos por sessão e propósito; Voice, Soundboard, Ping, clipping e VU recebem o dono correto. |
| M12 — engines | Room, Voice, Co-op, UI, Discord, clipping, WebRTC, stats e gamepad separados em responsabilidades internas. |
| M13 — CSS | Extração semântica; raízes preservam a cascata; antiga ferramenta por linhas virou validador. |
| M14 — HTML | Modais em templates, páginas estáticas geradas e consentimento/controladores sem duplicação inline. |
| M15 — Rust | Configuração, controle, pipeline, plataforma, negociação e comandos em submódulos; espera GStreamer limitada compartilhada. |
| M16 — caminhos reais | Checks de produção Rust e E2E com PeerJS/WebRTC/DataChannel reais em ambiente local. |
| M17 — E2E | Harness compartilhado de servidor, signaling, browser, lifecycle, proveniência, fixtures e telemetria; alvo live explícito. |
| M18 — build/documentação | Scripts canônicos, distribuição, templates verificáveis, CI frontend e guia de colaboração. |

O escopo não exige fracionar todo arquivo longo: builders, DTOs e runners que têm uma responsabilidade única permanecem coesos. As fachadas de compatibilidade existem para preservar consumidores; não são o caminho de montagem das páginas atuais.

## Publicação e limites

A validação foi realizada sobre a base `6c7a010` e os complementos organizados nos commits temáticos desta entrega: protocolo/Co-op, sessões/mídia, templates HTML, testes/CI e documentação. Os novos arquivos de templates, tooling, captura e regressões integram esses commits na `dev`. A publicação na `dev` não promove automaticamente `alfa`, `main` ou produção; a execução remota do workflow não faz parte das evidências locais acima.

Continuam exigindo homologação específica: captura física desktop de um jogo completo, controladores reais/ViGEm e TURN entre redes distintas. Não foram repetidos todos os benchmarks nativos históricos nem feito deploy.

Consulte o [guia de arquitetura e colaboração](arquitetura-e-colaboracao.md) e a [verificação de conclusão](verificacao-conclusao-modularizacao-2026-09-30.md). A [auditoria original](auditoria-modularizacao-2026-09-30.md) e os inventários preservam a fotografia anterior à implementação.
