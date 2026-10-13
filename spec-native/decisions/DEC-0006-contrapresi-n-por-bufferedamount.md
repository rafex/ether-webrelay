+++
doctype = "decision"
id = "DEC-0006"
title = "Contrapresión por bufferedAmount"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0001"]
related_tasks = []
related_architecture = ["ARCH-0003"]
supersedes = []
tags = ["concern/performance", "concern/resilience"]
+++

# DEC-0006 - Contrapresión por bufferedAmount

## Contexto

Si el enlace es más lento que el bitrate, encolar indefinidamente dispara la latencia y la memoria.

## Decisión

BackpressureGate: >2 MiB en bufferedAmount descarta video delta y espera keyframe (lo pide una vez por hueco); >8 MiB descarta audio. Primera muestra tras un hueco lleva DISCONTINUITY.

## Consecuencias

Bajo congestión el espectador ve congelamientos cortos en vez de artefactos o retraso creciente.

## Alcance actualizado (2026-10-13)

Desde DEC-0012 esta decisión aplica solo al transporte alternativo `websocket` ("solo emisor"). El transporte principal es WebRTC (DEC-0009).
