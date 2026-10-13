+++
doctype = "decision"
id = "DEC-0004"
title = "Protocolo binario v1 sobre WebSocket"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0001"]
related_tasks = []
related_architecture = ["ARCH-0003"]
supersedes = []
tags = ["concern/protocol", "component/bridge-link"]
+++

# DEC-0004 - Protocolo binario v1 sobre WebSocket

## Contexto

El puente necesita tramas autodescriptivas con marcas de tiempo para sincronizar audio y video y detectar pérdidas.

## Decisión

Cabecera binaria de 28 bytes big-endian (magic 0x4557, versión, tipo, pista, flags KEYFRAME/DISCONTINUITY, secuencia u32, timestamp i64 µs del reloj de sesión, duración, longitud) + payload; control en JSON (HELLO, CONFIG, BYE); mensajes del puente en JSON texto; subprotocolo ether-webrelay.v1; wss:// obligatorio salvo localhost.

## Consecuencias

Cambios incompatibles requieren PROTOCOL_VERSION nuevo y actualizar docs/protocol.md y tests/unit/protocol.test.ts en el mismo cambio.
