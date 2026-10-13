+++
doctype = "convention"
id = "CONV-0002"
title = "Testing: pirámide y TDD"
status = "active"
created_at = "2026-10-13"
related_architecture = []
related_decisions = []
tags = ["concern/testing"]
+++

# CONV-0002 - Testing: pirámide y TDD

## Justificación

Regla 03: el testing es parte del build.

## Regla

Unitarios (tests/unit) sin red, fs ni APIs de navegador, con fakes de tests/support/fakes.ts y reloj manual. Integración (tests/integration) con WebSocket real contra tests/support/mock-bridge.ts y render real de Pug. Arquitectura (tests/architecture). Cobertura ≥80 % en dominio, aplicación y transporte (make coverage). Todo bug corregido trae su test.

## Consecuencias

Los adaptadores que requieren un navegador real (WebCodecs, captura) se verifican manualmente o con E2E de navegador (pendiente en ROADMAP).
