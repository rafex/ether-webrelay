+++
doctype = "decision"
id = "DEC-0005"
title = "Reconexión con reanudación del stream"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0001"]
related_tasks = []
related_architecture = ["ARCH-0003"]
supersedes = []
tags = ["concern/resilience", "concern/protocol"]
+++

# DEC-0005 - Reconexión con reanudación del stream

## Contexto

Las caídas breves de red no deben terminar la transmisión pública.

## Decisión

Backoff exponencial 0.5→10 s con ±20 % jitter, 20 intentos. HELLO con el mismo streamId y resume:true; reloj y secuencia continúan; CONFIG reenviadas; video descartado hasta un keyframe marcado DISCONTINUITY. Heartbeat 5 s, 3 silencios = reconectar. error fatal del puente = sin reintentos.

## Consecuencias

El puente debe conservar la sesión RTMPS un periodo de gracia para aprovechar resume (recomendación documentada).
