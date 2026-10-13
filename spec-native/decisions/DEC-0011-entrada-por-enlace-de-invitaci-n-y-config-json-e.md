+++
doctype = "decision"
id = "DEC-0011"
title = "Entrada por enlace de invitación y config.json en tiempo de ejecución"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0002"]
related_tasks = []
related_architecture = ["ARCH-0005"]
supersedes = []
tags = ["concern/config", "concern/deployment"]
+++

# DEC-0011 - Entrada por enlace de invitación y config.json en tiempo de ejecución

## Contexto

El invitado no debe configurar nada; el despliegue necesita apuntar a distintos puentes sin recompilar.

## Decisión

La app solo arranca desde /join/<sala>?t=<token>. La ubicación del puente y los valores por defecto (transport, perfil, vista, modelo de efectos) se leen de /config.json, que el contenedor genera al arrancar desde variables WEBRELAY_* (sin bind mounts, que fallan con VMs de podman en macOS).

## Consecuencias

Una misma imagen sirve a cualquier puente. config.json no se cachea. Sin enlace válido se muestra una pantalla explicativa.
