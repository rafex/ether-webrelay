+++
doctype = "convention"
id = "CONV-0005"
title = "Cambios al protocolo"
status = "active"
created_at = "2026-10-13"
related_architecture = []
related_decisions = ["DEC-0004"]
tags = ["concern/protocol", "workflow/review"]
+++

# CONV-0005 - Cambios al protocolo

## Justificación

El protocolo es el único contrato con el puente externo.

## Regla

Todo cambio en src/domain/protocol.ts actualiza docs/protocol-websocket.md y tests/unit/protocol.test.ts en el mismo commit; cambios incompatibles incrementan PROTOCOL_VERSION y el subprotocolo (ether-webrelay.vN); los mensajes desconocidos del puente se ignoran.

## Consecuencias

El equipo del puente puede depender de docs/protocol-websocket.md como fuente de verdad.
