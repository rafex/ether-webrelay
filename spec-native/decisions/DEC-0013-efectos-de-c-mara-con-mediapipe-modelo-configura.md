+++
doctype = "decision"
id = "DEC-0013"
title = "Efectos de cámara con MediaPipe, modelo configurable y degradación segura"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0002"]
related_tasks = []
related_architecture = ["ARCH-0005"]
supersedes = []
tags = ["tech/mediapipe", "component/effects"]
+++

# DEC-0013 - Efectos de cámara con MediaPipe, modelo configurable y degradación segura

## Contexto

El modal de ajustes de referencia incluye desenfoque y fondo virtual.

## Decisión

MediaPipeEffects (selfie segmenter de @mediapipe/tasks-vision fijado en 1.0.1) segmenta a 256 px, desenfoca por reducción-ampliación (sin filtros de canvas, compatible con Safari) o compone fondos procedurales o subidos. El wasm se empaqueta y carga bajo demanda; el modelo se toma de effectsModelUrl (por defecto el oficial de Google, autoalojable).

## Consecuencias

La CSP permite storage.googleapis.com en connect-src mientras se use el modelo remoto. Si algo falla, la cámara sigue sin efecto y la UI informa. Las imágenes subidas solo viven durante la sesión.
