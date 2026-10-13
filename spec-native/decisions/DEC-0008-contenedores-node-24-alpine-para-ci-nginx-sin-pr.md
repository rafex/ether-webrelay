+++
doctype = "decision"
id = "DEC-0008"
title = "Contenedores: Node 24 Alpine para CI, nginx sin privilegios para servir"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0001"]
related_tasks = []
related_architecture = ["ARCH-0004"]
supersedes = []
tags = ["concern/ci", "tech/podman", "concern/security"]
+++

# DEC-0008 - Contenedores: Node 24 Alpine para CI, nginx sin privilegios para servir

## Contexto

Reglas 06 y 08: CI local en contenedor, Podman primero, Containerfile, Alpine fijado por digest.

## Decisión

containers/ci/Containerfile (node:24-alpine por digest de índice multi-arch) ejecuta make install lint build test; el árbol entra por tar en stdin (sin bind-mount) para funcionar con VMs de podman en macOS. containers/frontend/Containerfile compila y sirve dist/ con nginx-unprivileged (puerto 8080, CSP, Permissions-Policy, /healthz). just up lo publica solo en 127.0.0.1.

## Consecuencias

Exponer fuera de localhost requiere TLS delante (contexto seguro para captura). Actualizar digests al subir versiones de imagen base.
