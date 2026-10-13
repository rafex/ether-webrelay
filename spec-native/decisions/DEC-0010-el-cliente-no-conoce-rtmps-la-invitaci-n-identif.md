+++
doctype = "decision"
id = "DEC-0010"
title = "El cliente no conoce RTMPS: la invitación identifica la sala"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0002"]
related_tasks = []
related_architecture = ["ARCH-0005"]
supersedes = []
tags = ["concern/scope", "concern/security"]
+++

# DEC-0010 - El cliente no conoce RTMPS: la invitación identifica la sala

## Contexto

El formulario original pedía URL y clave RTMPS en el navegador; el usuario indicó que eso es responsabilidad del puente.

## Decisión

El cliente solo maneja sala y token del enlace de invitación más la identidad del participante (nombre, título). Se elimina destination del HELLO v1 y de la configuración; los destinos RTMPS se resuelven solo en el puente (ether-streaming-culerin).

## Consecuencias

Ningún texto, campo ni configuración del cliente menciona RTMPS ni claves de stream (lo verifica pug-templates.test.ts). Los canales de room.info son solo informativos.
