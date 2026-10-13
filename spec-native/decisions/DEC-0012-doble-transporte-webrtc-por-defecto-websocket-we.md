+++
doctype = "decision"
id = "DEC-0012"
title = "Doble transporte: WebRTC por defecto, WebSocket + WebCodecs como solo emisor"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0002"]
related_tasks = []
related_architecture = ["ARCH-0005"]
supersedes = []
tags = ["concern/transport", "component/call"]
+++

# DEC-0012 - Doble transporte: WebRTC por defecto, WebSocket + WebCodecs como solo emisor

## Contexto

El usuario pidió conservar el pipeline WebCodecs existente como modo alternativo.

## Decisión

Ambos transportes implementan la misma interfaz CallController. transport en config.json (o en room.info) elige entre webrtc (por defecto) y websocket; en websocket la señalización solo se usa en el lobby y el participante no recibe a los demás.

## Consecuencias

DEC-0003, DEC-0004, DEC-0006 y DEC-0007 siguen vigentes acotadas al modo websocket. La UI muestra un aviso en ese modo. Mantener dos transportes tiene costo; el WebRTC es el camino principal.
