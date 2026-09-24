# Parecer Técnico: Diagnóstico e Resolução de Transmissão em Salas Multi-Instâncias (3+ Participantes)

**Data**: 24 de Setembro de 2026  
**Contexto**: Salas com 3+ instâncias ativas (2 Desktops e 1 Web) e tentativa de transmissão a partir de um dos desktops.  
**Branch**: `main`  
**Commits**: `2f6e41c` (sincronizado em `origin/main` e `upstream/mason`)

---

## 1. O Problema Relatado

> *"Tive problemas para transmitir quando abri dois desktops e entrei com um web em uma sala (3 instancias) e tentei transmitir com 1 desktop. A transmissão não iniciou. Crie um teste para testar essas situações 3+"*

Ao abrir três instâncias simultâneas na mesma sala (duas janelas Desktop SeeMyGame e um cliente Web) e iniciar a transmissão a partir de uma instância Desktop, a transmissão não iniciava para os demais participantes ou ficava travada sem negociar o stream.

---

## 2. Diagnóstico & Causas-Raiz Identificadas

### Causa 1: Falta de Retransmissão (Relay) de Mensagens de Stream no Coordenador da Sala
* **Onde**: [`js/room.js`](file:///G:/SeeMyGame/js/room.js) nos tratadores `ROOM_STREAM_PUBLISHED`, `ROOM_STREAM_UNPUBLISHED` e `ROOM_MEMBER_STATE_UPDATE`.
* **Mecanismo da falha**: Em uma sala P2P com topologia em estrela coordenada pelo Master (Host determinístico):
  - Quando um membro comum (Desktop convidado) iniciava uma transmissão, ele emitia `ROOM_STREAM_PUBLISHED` apenas para as suas conexões diretas (que é o Master).
  - O Master recebia o anúncio, atualizava seu estado local e emitia o evento internamente, **mas nunca retransmitia** o anúncio para os outros membros da sala (ex: cliente Web).
  - Como consequência, o cliente Web nunca era notificado de que o Desktop convidado estava transmitindo, logo nunca enviava o handshake `REQUEST_STREAM`.

### Causa 2: Erro de Atribuição de Identidade do Streamer ao Retransmitir (`senderPeerId` vs `message.peerId`)
* **Onde**: [`js/room.js`](file:///G:/SeeMyGame/js/room.js) linha 530: `const peerId = senderPeerId;`.
* **Mecanismo da falha**:
  - Quando uma mensagem vinha do Master, `senderPeerId` era o próprio Master.
  - Se o Master retransmitisse um stream publicado por outro participante, o código assumia que quem estava transmitindo era o remetente da conexão (`senderPeerId` = Master), e não o autor real da stream (`message.peerId`).
  - O cliente tentava assistir ao Master (que não estava transmitindo) em vez do participante correto.

### Causa 3: Bloqueio de Conexões Pendentes entre Membros não-Master
* **Onde**: [`js/room.js`](file:///G:/SeeMyGame/js/room.js) em `case 'ROOM_MEMBER_JOINED':`.
* **Mecanismo da falha**:
  - Quando um terceiro membro (Web) conectava e tentava handshake direto com o segundo membro (Desktop), caso o evento `ROOM_MEMBER_JOINED` do coordenador ainda não tivesse chegado, a conexão ficava retida em `pendingConnections`.
  - Ao receber `ROOM_MEMBER_JOINED`, o membro adicionava o novo participante à lista, mas **não promovia** a conexão pendente para `meshConnections`. A conexão ficava estagnada como pendente para sempre.

### Causa 4: Duplo Disparo de Sinalização (`START_DIRECT_STREAM` e chamadas WebRTC duplicadas)
* **Onde**: [`js/app.js`](file:///G:/SeeMyGame/js/app.js) na função `startLocalStream()`.
* **Mecanismo da falha**:
  - Ao iniciar transmissão, o código iterava sobre `roomManager.meshConnections` e chamava `initiateMediaCallToViewer(viewerId)`.
  - Logo em seguida, iterava sobre `connectedViewers` e chamava `initiateMediaCallToViewer(viewerId)` **novamente** para os mesmos espectadores.
  - Isso gerava mensagens duplicadas de `START_DIRECT_STREAM`, chamadas WebRTC em duplicidade e condições de corrida entre ofertas/respostas SDP.

### Causa 5: Vazamento de Trava em `activeDirectSignaling`
* **Onde**: [`js/app.js`](file:///G:/SeeMyGame/js/app.js) em `handleDirectStreamOffer`.
* **Mecanismo da falha**:
  - Se `handleDirectStreamOffer` recebesse uma oferta antes de a captura nativa estar com `sessionId` ativo, retornava silenciosamente sem limpar `activeDirectSignaling.delete(viewerId)`. O espectador ficava permanentemente bloqueado para novas negociações diretas.

---

## 3. Correções Aplicadas

1. **Retransmissão Coordenada no Master ([`js/room.js`](file:///G:/SeeMyGame/js/room.js))**:
   - `ROOM_STREAM_PUBLISHED`: Quando o Master recebe a publicação de um membro, faz broadcast para todos os outros membros da sala, preservando o `peerId` original do streamer.
   - `ROOM_STREAM_UNPUBLISHED`: O mesmo para o encerramento de transmissão.
   - `ROOM_MEMBER_STATE_UPDATE`: O mesmo para estados de microfone e áudio.
   - Resolução correta de `peerId`:
     ```javascript
     const peerId = (senderPeerId === this.masterPeerId && message.peerId) ? message.peerId : senderPeerId;
     ```

2. **Promoção de Conexões Pendentes ([`js/room.js`](file:///G:/SeeMyGame/js/room.js))**:
   - Em `case 'ROOM_MEMBER_JOINED'`, verifica se já existia uma conexão em `pendingConnections` para aquele peer e promove-a imediatamente com `promoteConnection`.

3. **Deduplicação de Notificações em [`js/app.js`](file:///G:/SeeMyGame/js/app.js)**:
   - Apenas espectadores que **não** estão em `roomManager.meshConnections` são chamados a partir de `connectedViewers`.
   - Adicionada emissão de `STREAM_STATUS: true` para participantes da malha da sala.
   - Limpeza de `activeDirectSignaling` em retornos antecipados de `handleDirectStreamOffer`.

---

## 4. Nova Suíte de Testes para Salas com 3+ Instâncias

Criado o arquivo de testes dedicado: [`tests/multi-instance-room.test.js`](file:///G:/SeeMyGame/tests/multi-instance-room.test.js)

### Cenários Automatizados Cobertos:
1. **Host Desktop Transmitindo para 2 Espectadores (Desktop + Web)**:
   - Valida captura nativa Direct3D 11, envio de `START_DIRECT_STREAM` único, recebimento concorrente de `DIRECT_STREAM_OFFER` de ambos os espectadores, geração de `DIRECT_STREAM_ANSWER` com portas RTP efêmeras distintas no Fanout e inicialização correta de vídeo.
2. **Convidado Desktop Transmitindo com Retransmissão do Coordenador para Convidado Web**:
   - Valida que o Coordenador retransmite `ROOM_STREAM_PUBLISHED` e `ROOM_STREAM_UNPUBLISHED` para os demais membros preservando o `peerId` do streamer real.
3. **Promoção Automática de Conexões Pendentes**:
   - Valida que se um cliente Web conectar a um convidado Desktop antes do anúncio do coordenador, a conexão é retida com segurança e promovida a `meshConnections` assim que o coordenador envia a autorização.
4. **Retransmissão de Estados de Voz (Mute/Deafen)**:
   - Valida retransmissão de `ROOM_MEMBER_STATE_UPDATE` pelo coordenador para toda a sala 3+.
5. **Deduplicação Estrita de Notificações**:
   - Valida que nenhum espectador recebe chamadas de mídia ou mensagens duplicadas de início de stream.

---

## 5. Resultados de Validação

* **Vitest**: 47 arquivos de teste, **487 testes aprovados** (100% pass)
* **Cargo**: 29 testes unitários Rust aprovados (100% pass)
* **Git**: Sincronizado em `origin/main` e `upstream/mason`.
