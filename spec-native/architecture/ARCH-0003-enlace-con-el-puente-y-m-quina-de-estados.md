+++
doctype = "architecture"
id = "ARCH-0003"
title = "Enlace con el puente y máquina de estados"
status = "active"
created_at = "2026-10-13"
related_decisions = ["DEC-0004", "DEC-0005", "DEC-0006"]
related_specs = ["SPEC-0001"]
tags = ["component/bridge-link", "concern/resilience", "concern/protocol"]
+++

# ARCH-0003 - Enlace con el puente y máquina de estados

## Contexto

La red falla; la transmisión pública no debe cortarse por caídas breves del WebSocket.

## Diseño

BridgeLink gestiona handshake (HELLO→welcome, timeout 5 s), heartbeat (PING/pong cada 5 s, 3 silencios = conexión muerta), framing con secuencia continua y reconexión con ReconnectPolicy. RelaySession orquesta: reenvía CONFIG tras cada welcome, reinicia BackpressureGate (espera keyframe, marca DISCONTINUITY), pide keyframe al pipeline y expone estadísticas. Estados: idle → starting → live ⇄ reconnecting → stopping → stopped | failed.

## Restricciones y consecuencias

Errores fatales del puente terminan la sesión sin reintentos. Eventos de conexiones abandonadas se ignoran por número de intento. Ver docs/protocol.md.
