+++
doctype = "architecture"
id = "ARCH-0004"
title = "Estructura del repositorio y tooling"
status = "active"
created_at = "2026-10-13"
related_decisions = ["DEC-0008"]
related_specs = ["SPEC-0001"]
tags = ["component/tooling", "concern/build", "rule/ether-best-practice"]
+++

# ARCH-0004 - Estructura del repositorio y tooling

## Contexto

El estándar Ether My Best Practice define estructura por rol/lenguaje y una capa única de ejecución.

## Diseño

Raíz: Makefile (build/artefactos) que incluye helpers/mk/*.mk; Justfile (operativas) que importa helpers/just/*.just; helpers/shell (lógica real, logs de auditoría, --man); containers/ci y containers/frontend (Containerfile); docs/ (MkDocs + Mermaid + man_<tarea>.md); .github/workflows/ci.yml como wrapper. Código en source/frontend/nodejs/webrelay (único proyecto).

## Restricciones y consecuencias

Ningún comando npm/podman se invoca directamente desde Makefile, Justfile ni GitHub Actions; todo pasa por helpers/shell.
