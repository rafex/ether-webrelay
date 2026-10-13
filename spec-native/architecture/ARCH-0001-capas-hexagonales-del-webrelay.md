+++
doctype = "architecture"
id = "ARCH-0001"
title = "Capas hexagonales del webrelay"
status = "active"
created_at = "2026-10-13"
related_decisions = ["DEC-0001"]
related_specs = ["SPEC-0001"]
tags = ["component/frontend", "concern/architecture", "pattern/hexagonal"]
+++

# ARCH-0001 - Capas hexagonales del webrelay

## Contexto

El webrelay corre en el navegador pero su lógica (protocolo, reconexión, contrapresión, sincronía) debe probarse sin navegador y sobrevivir a cambios de APIs de medios.

## Diseño

source/frontend/nodejs/webrelay/src se divide en domain/ (puro, sin dependencias), ports/ (interfaces: MediaPipelinePort, TransportPort, Timer/TimeSource, TranscoderPort), application/ (RelaySession, BridgeLink), infrastructure/ (adaptadores de navegador: captura, compositor, Web Audio, WebCodecs, WebSocket, ffmpeg.wasm) y ui/ (adaptador de entrada sobre plantillas Pug). Dependencias permitidas: domain ← ports ← application; infrastructure → domain, ports; ui → todas. domain/ y application/ no usan APIs del navegador ni paquetes npm.

## Restricciones y consecuencias

tests/architecture/layers.test.ts falla ante cualquier import que viole las reglas. Toda API de navegador nueva entra como adaptador detrás de un puerto. Ver docs/architecture.md.
