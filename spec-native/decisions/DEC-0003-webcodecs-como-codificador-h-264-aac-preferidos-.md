+++
doctype = "decision"
id = "DEC-0003"
title = "WebCodecs como codificador; H.264+AAC preferidos; ffmpeg.wasm solo para OGV"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0001"]
related_tasks = []
related_architecture = ["ARCH-0002"]
supersedes = []
tags = ["tech/webcodecs", "tech/ffmpeg-wasm", "concern/performance"]
+++

# DEC-0003 - WebCodecs como codificador; H.264+AAC preferidos; ffmpeg.wasm solo para OGV

## Contexto

Hay que codificar en tiempo real con el menor costo de CPU y que el puente pueda publicar en RTMP/FLV sin transcodificar.

## Decisión

VideoEncoder/AudioEncoder con latencyMode realtime y prefer-hardware. Preferencia H.264 (high→main→baseline, AVCC, CBR si se soporta) y AAC-LC raw; respaldo VP8 y Opus (el puente transcodifica). El nivel H.264 se calcula de resolución y fps. ffmpeg.wasm (self-hosted, carga diferida) solo convierte grabaciones locales WebM a OGV (Theora/Vorbis).

## Consecuencias

El bundle principal no incluye los 32 MB de ffmpeg-core.wasm. Navegadores sin WebCodecs no son soportados (se informa al iniciar).
