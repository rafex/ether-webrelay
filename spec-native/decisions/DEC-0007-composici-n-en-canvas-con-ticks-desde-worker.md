+++
doctype = "decision"
id = "DEC-0007"
title = "Composición en canvas con ticks desde Worker"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0001"]
related_tasks = []
related_architecture = ["ARCH-0002"]
supersedes = []
tags = ["component/media-pipeline", "concern/sync"]
+++

# DEC-0007 - Composición en canvas con ticks desde Worker

## Contexto

RTMP admite una pista de video; hay que combinar pantalla y cámara y seguir emitiendo frames con la pestaña en segundo plano.

## Decisión

Componer en un canvas 2D (pantalla con letterbox + cámara PiP) y emitir VideoFrame desde el canvas a la tasa configurada, con el temporizador en un Worker dedicado.

## Consecuencias

Costo de un drawImage por fuente y frame; a cambio, un único encoder y layout controlado. Layout configurable en domain/layout.ts.

## Alcance actualizado (2026-10-13)

Desde DEC-0012 esta decisión aplica solo al transporte alternativo `websocket` ("solo emisor"). El transporte principal es WebRTC (DEC-0009).
