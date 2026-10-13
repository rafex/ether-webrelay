+++
doctype = "convention"
id = "CONV-0001"
title = "Ubicación por capa y nombres"
status = "active"
created_at = "2026-10-13"
related_architecture = ["ARCH-0001"]
related_decisions = []
tags = ["concern/naming", "concern/architecture"]
+++

# CONV-0001 - Ubicación por capa y nombres

## Justificación

Mantener el hexágono legible y verificable.

## Regla

Archivos kebab-case; clases PascalCase; puertos con sufijo Port en src/ports/; constantes de dominio como objetos `as const` + tipo unión (no enum). Código, identificadores y comentarios en inglés; textos visibles para el usuario en español.

## Consecuencias

tests/architecture/layers.test.ts valida las dependencias entre capas.
