# Controle 3D baseado na referência de formato simétrico

Revisão `symmetric-3`, substituindo o modelo `shell-2`. A imagem fornecida pelo usuário orientou as proporções e a disposição dos comandos; o resultado é uma aproximação construída em geometria Three.js, sem reutilizar um modelo CAD original.

## Alterações visuais

- Carcaça branca com ombros arredondados e empunhaduras alongadas; base e inserto central escuros.
- Touchpad largo, com formato trapezoidal e cantos arredondados.
- Analógicos simétricos, posicionados abaixo do touchpad.
- Direcional com quatro teclas separadas e botões circulares com símbolos △ ○ ✕ □.
- Detalhes de alto-falante, luz de status, teclas de sistema, bumpers e gatilhos.
- Iluminação mais neutra e feedback ciano ao pressionar os botões.

Mantidos os pivôs e nomes que o viewer usa para animar botões, analógicos e gatilhos. O modelo é uma ilustração comum a todas as marcas; os rótulos dos indicadores e o mapeamento dos inputs continuam seguindo o controle detectado.

O procedural e o GLB vêm do mesmo builder. O endereço do GLB usa a revisão para invalidar o cache anterior. O asset final tem aproximadamente 1,32 MiB; reduzida a subdivisão excessiva da primeira versão deste refinamento (3,01 MiB), preservando as curvas e os chanfros. A renderização continua entrando em repouso quando os inputs não mudam.

## Validação

- Suíte completa: **82 arquivos e 849 testes aprovados**, com quatro workers.
- Teste de montagem inclui simetria dos analógicos, proporção e posição do touchpad, comandos laterais, oclusão dos botões, clique sem deslocamento duplicado e equivalência GLB/procedural.
- E2E visual aprovado com renderização real em Chrome, modelos GLB e procedural em repouso, pressionados e liberados; sem oclusões detectadas nem erros da página.
- E2E da sala aprovado: quatro participantes, aceite, inputs isolados via WebRTC, checklist/Pronto, quatro renderizadores, layout móvel e fluxo Room. Uma tentativa anterior expirou na conexão do terceiro convidado, antes de abrir a tela; as duas execuções seguintes passaram. Isso não determina a causa da falha transitória de conexão.
- Checks de módulos, HTML, CSS, smoke ESM e diff aprovados. Build `dist` atualizado.

Evidências atuais: `output/playwright/gamepad-model/after.png`, `released.png`, `report.json`; `output/playwright/controller-lab/desktop.png`, `mobile.png`, `room.png`, `report.json`. As capturas são sobrescritas pelos testes.

Os inputs dos E2E são simulados; WebGL, GLB e transporte WebRTC são reais. Esta validação não substitui teste com gamepads físicos ou no executável Tauri. Recarregue a página para ver a alteração. Um executável que embute o frontend antigo precisa ser reconstruído.
