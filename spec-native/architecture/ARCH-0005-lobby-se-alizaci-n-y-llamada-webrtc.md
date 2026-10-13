+++
doctype = "architecture"
id = "ARCH-0005"
title = "Lobby, señalización y llamada WebRTC"
status = "active"
created_at = "2026-10-13"
related_decisions = ["DEC-0009", "DEC-0010", "DEC-0011", "DEC-0012", "DEC-0013", "DEC-0014"]
related_specs = ["SPEC-0002"]
tags = ["component/call", "component/lobby", "concern/architecture"]
+++

# ARCH-0005 - Lobby, señalización y llamada WebRTC

## Contexto

La experiencia pasa de un formulario técnico a antesala + videollamada multi-participante.

## Diseño

WebRelayApp (ui) carga config.json y la invitación, crea un SignalingClient (WebSocket compartido: backoff, heartbeat, errores fatales con mensajes amigables) y LobbyService (room.peek, vista previa por dispositivo, preferencias, LocalMediaProvider con efectos). Al entrar, la vista previa se transfiere a un CallController: WebRtcCallSession (publish/subscribe, cola de mensajes en orden, ICE encolado, renegociación serializada, replaceTrack para toggles, perfil del puente en los senders, ICE restart, rejoin con resume, estadísticas) o WebSocketCallSession (RelaySession + pipeline WebCodecs con fuentes en caliente). CallView renderiza tres vistas; CallRecorder graba en ui.

## Restricciones y consecuencias

Un único snapshot por transporte alimenta la UI. Las dependencias siguen ARCH-0001 (el recorder vive en ui porque depende de application).
