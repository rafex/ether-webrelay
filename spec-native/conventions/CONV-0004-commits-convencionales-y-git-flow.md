+++
doctype = "convention"
id = "CONV-0004"
title = "Commits convencionales y Git Flow"
status = "active"
created_at = "2026-10-13"
related_architecture = []
related_decisions = []
tags = ["concern/git", "workflow/commits"]
+++

# CONV-0004 - Commits convencionales y Git Flow

## Justificación

Regla 05 y hook commit-msg.

## Regla

Conventional Commits (feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert, scope opcional). Ramas feature/*, bugfix/*, release/*, hotfix/*; nada directo a main; PR con CI verde. Hooks en .githooks (just setup).

## Consecuencias

commit-msg rechaza mensajes no convencionales; pre-commit corre lint + typecheck; pre-push corre tests.
