+++
doctype = "convention"
id = "CONV-0006"
title = "Cambios a la señalización v2"
status = "active"
created_at = "2026-10-13"
related_architecture = []
related_decisions = ["DEC-0009"]
tags = ["concern/protocol", "workflow/review"]
+++

# CONV-0006 - Cambios a la señalización v2

## Justificación

docs/signaling.md es el contrato con ether-streaming-culerin.

## Regla

Todo cambio en src/domain/signaling.ts actualiza en el mismo commit docs/signaling.md, tests/unit/signaling.test.ts y tests/support/dev-bridge.mjs; cambios incompatibles cambian el subprotocolo (ether-webrelay.signaling.vN). Mensajes desconocidos se ignoran en ambos sentidos.

## Consecuencias

El doble de prueba y el E2E detectan divergencias entre cliente y contrato.
