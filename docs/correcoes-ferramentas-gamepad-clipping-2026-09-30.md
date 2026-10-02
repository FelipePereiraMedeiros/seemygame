# Correções das ferramentas de gamepad, laser e clipping — 30/09/2026

Complemento à revisão `verificacao-ferramentas-gamepad-clipping-2026-09-30.md`. As alterações locais existentes foram preservadas. Este documento descreve as correções aplicadas após aquela revisão, sem converter testes simulados em comprovação de hardware.

## Correções implementadas

| Área | Comportamento corrigido | Evidência |
| --- | --- | --- |
| Visualizador 3D | O modal respeita o retorno booleano de `init()`. Destrói recursos quando WebGL falha, preserva o fallback e inicia o viewer caso o modal tenha aberto enquanto o módulo carregava. Não inicializa depois do descarte. | `tests/gamepad-tester-integration.test.js` |
| Seleção de controle | Uma vaga selecionada acompanha a conexão do controle naquele índice; a desconexão retorna à mesma vaga. Evita trocar silenciosamente para o primeiro controle. | `tests/gamepad-tester-integration.test.js` |
| Tipos e rótulos | Fabricantes explícitos prevalecem sobre nomes genéricos. 8BitDo não é confundido com Nintendo/Sony por “Pro Controller” ou “Wireless Controller”. O HUD utiliza rótulos do hardware no layout padrão, sem alterar o remapeamento. Rótulos físicos permanecem separados do destino remapeado. | `tests/gamepad-tester-integration.test.js`, `tests/coop.test.js` |
| Identidade do laser | O peer da conexão determina o remetente direto. Apenas o host autorizado do espectador pode transmitir `laserOriginPeerId`. Pontos e stop utilizam a mesma identidade; o plugin não modifica o payload recebido. | `tests/laser-identity.test.js`, `tests/gamer-features.test.js` |
| Share/Create | No gamepad PlayStation padrão, Share/Create é botão 8. O botão 16 (Home/PS/Guide) não dispara clipe. Controles não padronizados não são interpretados por índices arbitrários. | `tests/clip-shortcut-regressions.test.js` |
| Atalhos | Bordas de pressão são independentes por controle. Debounce continua compartilhado. Teclado ignora repetição, composição de texto, eventos consumidos, digitação e os editores abertos. Limpeza remove polling, listeners e destaque; sessões encerradas não exportam. | `tests/clip-shortcut-regressions.test.js`, `tests/clipping.test.js` |

O tooltip de clipping explica que C, Alt+C e Ctrl+Shift+C exigem foco no SeeMyGame. Foi corrigida a interpretação de “global”: o listener cobre a página, mas não registra atalhos no Windows. Não foi adicionada uma integração nativa de hotkeys nesta correção. Polling de gamepad por requestAnimationFrame também não garante execução em segundo plano.

## Validação

- 29 novos testes de regressão em três arquivos.
- Suíte completa: **76 arquivos e 771 testes aprovados**.
- Grafo de módulos e imports ESM: aprovados, sem iniciar listeners, rede, áudio ou timers durante importação.
- Consistência de parciais HTML: aprovada.
- Build de distribuição atualizado em `G:\SeeMyGame\dist`.
- Os avisos de canvas/navegação do jsdom não representam execução de WebGL real. Não foi realizado teste com controles físicos nem com jogo em foco.

## Limites mantidos

A lista XInput continua sendo fallback quando a API web não detecta controles; combinar ambas sem identificação confiável pode listar o mesmo dispositivo duas vezes. Índices físicos do tester não equivalem a atribuição automática de jogadores remotos. 8BitDo conserva rótulos Xbox como fallback, pois o modo de compatibilidade pode ocultar fabricante e layout. “Calibração” continua significando visualização/remapeamento, sem adquirir centro/amplitude por dispositivo.

Hosts e espectadores precisam usar o protocolo atualizado de origem do laser. Um host antigo, sem `laserOriginPeerId`, será identificado como origem da conexão; não se aceita uma identidade declarada por uma conexão direta para manter compatibilidade insegura.
