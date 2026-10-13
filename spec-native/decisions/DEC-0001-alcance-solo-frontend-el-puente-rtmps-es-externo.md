+++
doctype = "decision"
id = "DEC-0001"
title = "Alcance: solo frontend; el puente RTMPS es externo"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0001"]
related_tasks = []
related_architecture = ["ARCH-0001"]
supersedes = []
tags = ["concern/scope", "component/bridge"]
+++

# DEC-0001 - Alcance: solo frontend; el puente RTMPS es externo

## Contexto

El planteamiento original incluía un servidor puente (WebSocket → FFmpeg → RTMPS). El usuario definió que este repositorio solo abarca el webrelay que se conecta al puente.

## Decisión

ether-webrelay contiene únicamente la aplicación de navegador. El puente es otro sistema; la frontera es el protocolo v1 (docs/protocol.md). Solo se permiten dobles de prueba del puente dentro de tests/.

## Consecuencias

No hay código de servidor ni dependencias de runtime de Node en producción. Cualquier cambio de contrato se coordina con el equipo del puente vía docs/protocol.md y versión del protocolo.
