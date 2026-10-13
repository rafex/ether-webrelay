+++
doctype = "convention"
id = "CONV-0003"
title = "Tooling: Makefile construye, Justfile opera, helpers ejecutan"
status = "active"
created_at = "2026-10-13"
related_architecture = ["ARCH-0004"]
related_decisions = []
tags = ["concern/build", "rule/ether-best-practice"]
+++

# CONV-0003 - Tooling: Makefile construye, Justfile opera, helpers ejecutan

## Justificación

Regla 01 de Ether My Best Practice.

## Regla

Makefile → helpers/mk/*.mk → helpers/shell/*.sh; Justfile → helpers/just/*.just → helpers/shell. Helpers con flags explícitos (--goal/--action, --module, --port, --log-file, --man) y log de auditoría (init_log). Cada target/receta tiene docs/man_<tarea>.md. CI externo solo invoca make.

## Consecuencias

Agregar una tarea implica: helper (o goal nuevo), target o receta, y su man page.
