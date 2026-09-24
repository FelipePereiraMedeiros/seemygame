# Revalidação R1–R10 — 24/09/2026

Código avaliado: `c99dc7b`, workspace inicialmente limpo. Comparação com `34e34e1` e leitura dos caminhos afetados. Nenhuma alteração de produção nesta rodada.

## Resultado

As correções avançaram, mas não é correto declarar todos os achados encerrados. R6 permanece aberto; R1/R2 precisam concluir o tratamento da interface; R10 ainda não garante liberação de inputs retidos. Os demais problemas originais foram corrigidos no código, com limitações de validação explicitadas abaixo.

| Achado | Estado | Evidência e pendência |
|---|---|---|
| R1 — áudio após desativação | Privacidade corrigida; fluxo parcial | `media.rs:1148` exige modo diferente de None para criar WASAPI; `capture.rs:733` remove a porta no reinício sem áudio. Ativar áudio sem porta é rejeitado preservando o worker. Porém a interface não aguarda o resultado e anuncia modo aplicado mesmo na rejeição. |
| R2 — troca de codec | Backend protegido; interface parcial | `capture.rs:690` rejeita codec diferente antes de parar o worker. `app.js:201` ainda persiste o valor, transmite anúncio e mostra sucesso. O seletor incorreto é reenviado em ajustes posteriores, podendo bloquear também mudanças de bitrate. |
| R3 — sessão live sem worker | Corrigido no código | A falha do substituto agora muda para error, limpa bridges/fanout e emite estado. O monitor também trata worker ausente. Não há rollback, mas erro explícito era alternativa válida. Falta teste de falha no comando real. |
| R4 — reinício por evento do slider | Corrigido para o cenário original | Debounce de 250 ms, aplicação no change e fila serializada com consolidação de parâmetros. Ainda são reinícios, não ajuste contínuo do encoder. Não há teste dedicado de rajada/serialização nesta nova suíte. |
| R5 — anunciar transmissão ociosa | Corrigido para o cenário original | `app.js:534` condiciona publicação e anúncios à existência de captura/stream. A nova suíte não comprova esse cenário com uma sala ociosa. |
| R6 — clipping e áudio tardio | Não encerrado | Reinicia o gravador, mas perde flush assíncrono do anterior e mistura segmentos independentes sem remux ou gestão de cabeçalhos/trilhas. |
| R7 — listener do clipping | Corrigido | Limpeza ocorre antes de apagar `this.stream`; callback também verifica geração e estado. Há teste de remoção do listener. |
| R8 — propriedade inválida de queue | Corrigido no código | `native_viewer.rs:349` usa `set_property_from_str("leaky", "downstream")`. Não foi feito novo E2E até apresentação de frame no receptor nativo. |
| R9 — script fora do pacote | Corrigido na configuração | Bundle inclui `tools/install-vigem.ps1`; resolução considera caminho junto ao executável. Falta instalar NSIS sem checkout para comprovar entrega e execução completas. |
| R10 — slots incompatíveis | Parcial | Setters revogam slots e recepção filtra slots permitidos. Falta neutralizar teclado/mouse já pressionados na revogação individual; teste de rejeição de inputs não exerce o handler corretamente. |

## Pendências concretas

### 1. R6: perda de dados e exportação entre gravações independentes

Em `js/clipping.js:96`, `requestData()` e `stop()` são chamados, mas o código imediatamente substitui `this.mediaRecorder` em `:116`. O `ondataavailable` do gravador anterior é descartado pela condição de identidade em `:163`. Portanto, o flush solicitado não preserva seu último bloco.

Executei uma reprodução determinística em Node, usando o módulo real e um MediaRecorder simulado com entrega assíncrona. Resultado: os chunks conservaram `HEADER_OLD` e `HEADER_NEW_WITH_AUDIO`, mas perderam `FINAL_OLD`; `initializationChunk` continuou apontando para `HEADER_OLD`.

Além disso, `exportClip` concatena blobs dos gravadores independentes. Não há normalização dos novos cabeçalhos, trilhas ou timestamps. O ramo que remove inicialização antiga também pode combinar cabeçalho de vídeo puro com clusters da gravação com áudio. Essa análise não substitui decodificar um arquivo real, mas demonstra que preservar o array não é preservar um WebM contínuo válido.

**Para encerrar:** aguardar e coletar o final do gravador anterior, identificar segmentos e produzir exportação válida por remux/normalização, ou adotar estratégia explícita que não prometa preservar histórico incompatível. Testar áudio depois de 500 ms, captura do último bloco, vídeo/áudio antes e depois da transição e arquivo exportado realmente decodificado.

### 2. R1/R2: rejeição do backend ainda aparece como sucesso

Os handlers de codec (`js/app.js:201`) e áudio (`:707`, aproximadamente) usam `.catch(console.warn)` e continuam atualizando interface/sala. Ao selecionar AV1 durante H.264, o backend preserva H.264, mas a UI anuncia AV1. Ao reativar áudio depois de `none`, a porta foi removida e o backend exige reinício, porém a interface pode anunciar áudio ativo.

**Para encerrar:** aguardar resultado, publicar somente estado confirmado, restaurar seletor na falha e explicar a necessidade de reiniciar. Não reenviar configuração rejeitada em ajustes de bitrate subsequentes. Testar rejeição e sucesso com assertions de estado, anúncios e seletor.

### 3. R10: neutralização incompleta e falso positivo no teste

`revokeCoopPlayer` em `js/coop.js:556` desconecta gamepad nativo e remove autorização, mas não libera teclas do fallback do navegador. Com outros slots ativos, também mantém o companion conectado sem reset por jogador. Uma tecla pressionada antes da revogação pode permanecer ativa, porque o keyup posterior será rejeitado pela autorização removida. É necessário rastrear/liberar estado por jogador ou definir reset seguro ao mudar o modo.

Em `tests/review-audit-fixes.test.js:182`, a chamada usa `handleHostCoopMessage(inputMsg, 'attacker-p3', connP3)`. A assinatura é `(senderPeerId, data, conn)`: como data recebe uma string, o handler retorna imediatamente. `not.toThrow()` não prova ausência de despacho. O teste também usa `down: true`, enquanto o despacho de teclado consulta `action`.

**Para encerrar:** corrigir ordem/payload, observar ausência de dispatch/IPC e testar keydown autorizado → redução de modo → keyup/reset efetivo → rejeição de novos inputs.

## Validação executada

- `npm test`: **49 arquivos, 496 testes aprovados**.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --offline`, com GStreamer local no PATH: **29 testes aprovados**.
- Reprodução controlada do flush assíncrono do clipping: confirmou descarte do bloco antigo.
- A suíte `review-audit-fixes.test.js` tem cinco casos concentrados em R6/R7/R10, apesar do título R1–R10. O teste Rust adicional verifica ausência do ramo WASAPI para None, não uma sessão completa com espectadores.
- Testes de biblioteca não exercitam diretamente comandos sob `cfg(not(test))`. Não foram executados instalação NSIS, novo benchmark ou E2E de áudio/codec nesta rodada.

Prioridade: corrigir exportação/flush de R6, alinhar interface às rejeições R1/R2 e concluir liberação de inputs R10. Depois validar os cenários reais de mídia e instalação para fechar os itens corrigidos apenas por inspeção/testes unitários.
