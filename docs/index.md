---
title: Ether WebRelay
tags: [overview]
---

# Ether WebRelay

Relay **de navegador** para transmisiones en vivo: captura cámara, micrófono y
pantalla, los codifica con **WebCodecs** (H.264/AAC, con VP8/Opus de
respaldo) y los entrega por **WebSocket** (`wss://`) a un **puente externo**
que publica en **RTMPS** (YouTube, Twitch o servidor propio).

!!! note "Alcance"
    Este repositorio contiene solo el webrelay (frontend). El puente es un
    sistema aparte; su contrato es el [protocolo v1](protocol.md).

- [Guía de inicio](getting-started.md) — levantar en local o en contenedor.
- [Arquitectura](architecture.md) — hexágono, flujo de medios, estados.
- [Protocolo v1](protocol.md) — formato de tramas, handshake, reconexión.
