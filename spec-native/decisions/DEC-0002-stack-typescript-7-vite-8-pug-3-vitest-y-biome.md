+++
doctype = "decision"
id = "DEC-0002"
title = "Stack: TypeScript 7 + Vite 8 + Pug 3, Vitest y Biome"
status = "accepted"
created_at = "2026-10-13"
owners = []
related_specs = ["SPEC-0001"]
related_tasks = []
related_architecture = []
supersedes = []
tags = ["concern/stack", "tech/typescript", "tech/vite", "tech/pug"]
+++

# DEC-0002 - Stack: TypeScript 7 + Vite 8 + Pug 3, Vitest y Biome

## Contexto

El usuario pidió TypeScript, Vite y Pug. La regla 08 exige versiones fijas y Node LTS.

## Decisión

TypeScript 7.0.2, Vite 8.3.4, Pug 3.0.4 integrado con un plugin propio (build/vite-plugin-pug.ts: placeholders <pug src> en index.html, recarga completa al editar .pug), Vitest 5 + coverage v8, Biome 2 para lint/format, Node 24 LTS (.nvmrc). Gestor npm (pnpm no está disponible en el entorno; la regla lo permite).

## Consecuencias

Sin ESLint: typescript-eslint depende de la API JS de TypeScript, ausente en TS 7 nativo. Las plantillas se renderizan en build: no hay Pug en runtime.
