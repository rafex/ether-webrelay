+++
doctype = "decision"
id = "DEC-0014"
title = "Puente de desarrollo werift como doble de prueba y E2E con Playwright"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0002"]
related_tasks = []
related_architecture = ["ARCH-0005"]
supersedes = []
tags = ["concern/testing", "tech/webrtc"]
+++

# DEC-0014 - Puente de desarrollo werift como doble de prueba y E2E con Playwright

## Contexto

Sin el puente real no se pueden probar el lobby ni la llamada multi-participante de extremo a extremo.

## Decisión

tests/support/dev-bridge.mjs implementa la señalización v2 y un mini SFU con werift (0.24.4, dependencia de desarrollo). Lo usan just bridge-dev y el E2E de Playwright (1.62.1): local con Chrome instalado, en CI dentro de la imagen oficial de Playwright fijada por digest. El micrófono del E2E es un tono sintético de Web Audio.

## Consecuencias

No publica RTMPS ni es código de producción (DEC-0001). La imagen E2E es Ubuntu: excepción documentada a Alpine porque Chromium requiere glibc.
