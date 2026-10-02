# Verificação das cinco ferramentas — 30/09/2026

**Atualização:** este é o parecer anterior às correções. O resultado da implementação e dos novos testes está em [correcoes-ferramentas-gamepad-clipping-2026-09-30.md](correcoes-ferramentas-gamepad-clipping-2026-09-30.md).

Base: HEAD `5ef445d` com as alterações locais presentes no início da revisão. As funcionalidades novas de seletor, detecção, laser e atalhos estão principalmente nessas alterações ainda não commitadas. Revisão por leitura de integração e testes; sem controlador físico ou validação visual em WebGL real nesta rodada. Nenhum código de produção alterado.

## Resultado por item

### 1. Visualizador 3D: tamanho e feedback

Implementado no engine. `js/gamepad-3d-viewer.js:130` calcula proporção efetiva; `renderer.js` trata dimensões ocultas/visíveis, atualiza câmera/projeção e tamanho do renderer. Há ResizeObserver e recalculação ao abrir. `mapping.js` anima analógicos/gatilhos, deprime meshes e altera emissão dos botões; o tester entrega inputs em `tester-controller.js:321`.

Pendência de integração: `tester-controller.js:52` usa `viewer3D.init().catch(...)`, mas init retorna boolean. O `.catch` causa TypeError, capturado pela cadeia do import como falha de carregamento. Se init já concluiu, isso não desfaz o viewer, mas torna o diagnóstico incorreto e não trata uma inicialização que retorne false. Deve verificar o boolean diretamente. Os testes do engine passam sem validar esse contrato completo no modal real.

“Calibração” aqui significa visualização/remapeamento; não encontrei nessa mudança uma rotina de aquisição e persistência de centro/amplitude dos eixos por dispositivo.

### 2. Até quatro controles e slots disponíveis

Implementado no tester: opções `web:index`, fallback `xinput:index` e vagas `vacant:0..3`, atualização por assinatura dos controles e mensagens persistentes para conectar mais unidades. A opção vaga mostra estado de espera. Template e room.html contêm o aviso.

São índices de controles físicos apresentados pelo navegador/Windows; não equivalem automaticamente a uma atribuição de jogador remoto nos slots do co-op. O tester visualiza o controle selecionado, não quatro modelos simultâneos. O fallback XInput é utilizado quando nenhum controle web está disponível; não combina as duas listas para descoberta completa em ambiente misto.

### 3. Isolamento de trilhas do laser

Implementado: `js/ping.js:13` mantém Map por senderId; adicionar/parar/limpar seleciona a trilha desse remetente. A origem local permanece `local`, enquanto `gamer-features.js` transmite myId. O plugin injeta remetente nos pontos recebidos e trata stop. Os testes verificam dois usuários sem unir pontos e clear seletivo.

Limitação: o plugin dá preferência ao senderId recebido no payload e mantém um senderId já presente no ponto. Isso é isolamento por identidade declarada, não comprovação de identidade autenticada. Um remetente malicioso pode escolher a chave de outro usuário. Relay precisa preservar origem com validação, em vez de confiar cegamente no payload ou substituir sempre pelo peer do relay.

### 4. Tipos e rótulos de gamepad

Implementados detectGamepadType e tabelas PlayStation/Nintendo/Xbox em `js/coop/input.js:174`, conectados ao seletor e HUD. Preset PlayStation aparece na interface; 8BitDo aparece como tipo detectado.

Limitações:

- O layout padrão Xbox prevalece sobre o tipo detectado em getButtonDisplayLabel. Um DualSense pode ser identificado no seletor e continuar mostrando A/B/X/Y até o usuário selecionar PlayStation. Detecção não significa seleção automática de layout.
- As heurísticas amplas precedem fabricantes específicos: “8BitDo Pro Controller” pode ser classificado como Nintendo; “Wireless Controller” de terceiros pode ser classificado como PlayStation.
- 8BitDo usa rótulos Xbox como fallback, sem perfil dedicado por modelo/modo. Modos XInput também podem ocultar o fabricante original no ID.
- Rótulos/presets não demonstram suporte a todo dispositivo non-standard, pois os caminhos assumem índices convencionais de botões/eixos.

### 5. Atalhos para clipe/AudioMaker

Integração confirmada: `session-composition.js:71` chama bindClipEditor; exportação abre o editor em `js/clipping/editor-controller.js:21`. Teclado aceita Alt+C, Ctrl+Shift+C e C simples, preservando digitação em inputs/textarea/select/contenteditable. Debounce compartilhado de 1.500 ms. Gamepad faz polling, detecta transição de solto para pressionado e aceita Back/Select(8)+RB/R1(5). Há cleanup da sessão.

Pendências:

- O atalho chamado Share usa índice 16. As próprias tabelas identificam esse índice como PS/Home/Xbox Guide, e Share/Create no PlayStation como 8. Portanto Share sozinho não foi implementado corretamente para o mapeamento descrito; Guide pode disparar clipe indevidamente.
- “Global” é listener da página. Não é hotkey do sistema operacional para quando o jogo tem foco. Polling em requestAnimationFrame também depende do estado do navegador e não garante funcionamento em segundo plano.
- Teclado não ignora `event.repeat`: segurar a tecla pode disparar novamente após 1.500 ms. A detecção de borda só está presente no gamepad e usa estado agregado de todos os controles.
- Não há teste de Share/Guide, repetição prolongada de tecla, foco no jogo ou quatro controles físicos. O teste do combo atual comprova apenas a chamada de exportação simulada.

## Validação

- 129 testes aprovados em seis arquivos: gamepad-3d, gamepad-3d-adversarial, adversarial-gamepad-modal, coop, ping e clipping.
- `npm run check:html`: aprovado.
- Validação real com WebGL/controladores, E2E de laser entre peers e atalhos enquanto jogo tem foco não foi executada.

Parecer: todas as cinco áreas têm código e integração, mas o item Share/global está parcialmente implementado e o contrato init do visualizador deve ser corrigido. Não declarar suporte completo a hardware ou atalhos do sistema com base nos testes atuais.
