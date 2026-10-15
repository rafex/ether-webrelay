---
title: Ether WebRelay
tags: [overview]
---

# Ether WebRelay

Antesala y **videollamada de navegador** para transmisiones en vivo: el
invitado abre un enlace, prueba cámara, micrófono y efectos en el lobby, entra
a la sala y ve a los demás participantes. Sus medios viajan por **WebRTC** al
**puente**, que compone la sala y la publica en **RTMPS** (YouTube, Twitch o
servidor propio). El cliente nunca conoce RTMPS.

!!! note "Alcance"
    Este repositorio contiene solo el webrelay (frontend). El puente vive en
    [`ether-streaming-culerin`](https://github.com/rafex/ether-streaming-culerin);
    su contrato es la [señalización v2](signaling.md).

- [Guía de inicio](getting-started.md) — requisitos y primeros pasos.
- [Levantar el frontend](running-frontend.md) — desarrollo, preview, contenedor, TLS y solución de problemas.
- [Arquitectura](architecture.md) — hexágono, flujo de medios, estados.
- [Flujo de medios](media-flow.md) — quién envía el video del cliente al puente y cómo (WebRTC, perfiles, diagnóstico).
- [Señalización v2](signaling.md) — contrato WebRTC con el puente.
- [Protocolo binario v1](protocol-websocket.md) — modo alternativo "solo emisor".
