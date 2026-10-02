# Sala de controles antes da partida

Implementada como uma tela dentro da sessão, sem navegação ou reconexão. Disponível em Room, Streamer e Viewer pelo botão 🎮 Controles (ícone 🎮 nas ações rápidas da Room).

## Uso

1. Abra Controles. No Room/Streamer, os amigos conectados recebem um convite; novos participantes também recebem enquanto houver lugar.
2. Cada amigo clica em **Entrar no teste**. Compartilhar inputs depende desse aceite.
3. Cada pessoa seleciona seu controle físico. Se o navegador ainda não o expôs, pressione um botão no controle.
4. Teste os quatro botões principais, os dois analógicos e os dois gatilhos. Depois marque **Pronto**.
5. O organizador pode liberar o acesso ao Co-op pelo painel de cada convidado. A tela escolhe um slot livre e mostra o número do Player atribuído. O mesmo botão revoga o acesso depois; a revogação solta as entradas daquele slot e, no Tauri, desconecta o gamepad virtual correspondente.
6. Use **Voltar à sala** ou Escape. O organizador encerra o teste do grupo; um convidado sai individualmente. A sala e suas conexões continuam ativas.

São quatro banners: organizador e três convidados, com modelo 3D independente, tipo de controle, botões, eixos numéricos, gatilhos e checklist. Nomes vêm da sessão; o fluxo clássico identifica convidados pelo número, pois seu nome padrão é Espectador. Em telas menores, o layout muda para duas ou uma coluna com rolagem vertical.

## Limites e segurança de interação

- O canal `GAMEPAD_TEST_*` é apenas diagnóstico. Não envia comandos aos adaptadores de jogo ou ViGEm.
- O Co-op é pausado localmente enquanto a tela está aberta: solta inputs ativos e preserva slots/dispositivos virtuais. Ao sair, retoma as autorizações atuais, incluindo alterações feitas pelo organizador no teste. Essa pausa não interrompe controles físicos usados diretamente pelo jogo fora do SeeMyGame.
- Pronto confirma apenas o checklist; o organizador libera a permissão de Co-op separadamente. Nenhum dos dois prova que um jogo recebeu o input.
- As ações de acesso aparecem apenas para o organizador numa sessão que permite gerenciar o Co-op. O convite para testar não concede permissão de jogo. A autorização passa pela mesma validação de slots e suporte de gamepad virtual do fluxo padrão.
- Atalhos de clipe por teclado/controle ficam suprimidos na tela; um botão Share mantido ao sair não dispara clipe.
- Inputs chegam no máximo a 20 Hz; o organizador limita mensagens de cada participante, valida conexão autorizada, sessão e posições e respeita backpressure. Dados fornecidos no payload não determinam a identidade do jogador.
- Troca/desconexão de controle ou mais de 1,5 s sem amostra limpa o estado Pronto. Aba oculta neutraliza a amostra local e pausa renderizadores.
- Usa a Gamepad API do navegador/WebView. Controles sem mapeamento padrão exibem aviso; não há promessa de remapeamento completo ou integração nativa XInput nesta tela.
- O modelo 3D é compartilhado entre marcas; rótulos dos botões seguem o hardware identificado. Se WebGL falhar, os indicadores de input continuam disponíveis.

## Validação

Testes unitários e de integração cobrem saneamento de valores, identidade, aceite, lotação, checklist, frequência, backpressure, snapshots inválidos/antigos, desconexão, encerramento, foco, fallback 3D, limpeza de recursos, enquadramento em diferentes proporções, pausa do Co-op e supressão dos atalhos de clipe.

Validação em 01/10/2026: **81 arquivos / 833 testes aprovados** (`npx vitest run --maxWorkers=4`), cinco verificações E2E aprovadas, sem pageErrors. Checks de módulos, HTML, CSS, smoke ESM e build dist também aprovados.

Execute `npm run test:e2e:controllers` para abrir quatro contextos Chrome com conexões WebRTC reais e confirmar convites, inputs separados, Pronto sincronizado, quatro modelos WebGL renderizados, layout móvel, retorno à sala e fluxo Room via mesh. O teste usa sinalização e servidor de assets locais e encerra os processos ao terminar.

**Os gamepads desse E2E são simulados via navigator.getGamepads; o transporte e a renderização são reais.** Ainda é necessária conferência manual com controles físicos e no aplicativo Tauri.

Evidências: `output/playwright/controller-lab/report.json`, `desktop.png`, `mobile.png`, `room.png`. Esses arquivos são sobrescritos a cada execução. O build `dist` inclui os novos módulos e assets; um executável Tauri já compilado precisa ser reconstruído para embuti-los.
