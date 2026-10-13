+++
doctype = "decision"
id = "DEC-0009"
title = "Videollamada WebRTC con señalización propia agnóstica del SFU"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0002"]
related_tasks = []
related_architecture = ["ARCH-0005"]
supersedes = []
tags = ["concern/protocol", "tech/webrtc", "component/call"]
+++

# DEC-0009 - Videollamada WebRTC con señalización propia agnóstica del SFU

## Contexto

El usuario pidió una antesala y una videollamada real donde los invitados se ven entre sí; el pipeline WebCodecs + WebSocket solo envía.

## Decisión

Los medios viajan por WebRTC con dos RTCPeerConnection por participante (publish ofrecida por el cliente, subscribe ofrecida por el puente). La señalización es un contrato JSON propio sobre WebSocket (subprotocolo ether-webrelay.signaling.v2, docs/signaling.md) que el puente traduce al SFU que elija; el cliente solo usa la API estándar RTCPeerConnection.

## Consecuencias

El cliente no depende de ningún SDK de SFU. Cambios al contrato siguen CONV-0006. publish.offer declara mid → fuente porque el SFU no puede deducir cámara/pantalla. Una oferta sin medios es inválida con max-bundle: no se ofrece publish sin pistas.
