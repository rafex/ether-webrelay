+++
doctype = "architecture"
id = "ARCH-0002"
title = "Pipeline de medios del navegador"
status = "active"
created_at = "2026-10-13"
related_decisions = ["DEC-0003", "DEC-0007"]
related_specs = ["SPEC-0001"]
tags = ["component/media-pipeline", "concern/sync", "tech/webcodecs"]
+++

# ARCH-0002 - Pipeline de medios del navegador

## Contexto

Hay que combinar cámara, micrófono, pantalla y audio del sistema en un único stream sincronizado, codificado con hardware cuando exista.

## Diseño

BrowserMediaPipeline: getDisplayMedia/getUserMedia → CanvasCompositor (pantalla a pantalla completa + cámara PiP, ticks desde un Worker para evitar throttling) → VideoFrame → WebCodecsVideoEncoder. Micrófono + audio de sistema → WebAudioMixer (GainNodes) → AudioWorklet pcm-tap (PCM planar f32) → AudioTimeline → WebCodecsAudioEncoder. Un único MediaClock estampa ambos; KeyframeScheduler fuerza GOP (2 s) y keyframes bajo demanda. LocalRecorder (MediaRecorder WebM) + FfmpegWasmTranscoder producen OGV bajo demanda.

## Restricciones y consecuencias

Una sola pista de video compuesta por transmisión. Los timestamps de audio derivan del conteo de muestras y nunca se solapan. El encoder descarta frames si su cola supera 3 (latencia acotada).
