# CI.md

Integración continua del proyecto.

## Plataforma

- Pipeline canónico: **local en contenedor** — `make ci`
  (`containers/ci/Containerfile`, Node 24 Alpine, podman → docker).
- Wrapper remoto: GitHub Actions, `.github/workflows/ci.yml` con dos jobs que
  solo invocan targets: `build-test` (`make ci`, `make app-image`) y `e2e`
  (`make e2e-ci`).
- Resultados: pestaña Actions del repositorio; localmente, la salida de
  `make ci` y los logs de auditoría en `/var/log/ether-webrelay/` o
  `/tmp/ether-webrelay/`.

## Triggers

| Evento | Pipeline que se ejecuta |
| --- | --- |
| Pull request abierto/actualizado | `make ci` → `make app-image` · `make e2e-ci` |
| Push a `main` o `develop` | `make ci` → `make app-image` · `make e2e-ci` |
| Commit local | hook `pre-commit` → `make pre-commit` |
| Push local | hook `pre-push` → `make pre-push` |

## Gates obligatorios

| Gate | Herramienta | Comando local |
| --- | --- | --- |
| Instalación reproducible | `npm ci` (lockfile) | `make install` |
| Lint + formato | Biome | `make lint` |
| Tipos | TypeScript 7 (`tsc --noEmit`) | `make typecheck` (incluido en `make build`) |
| Build | Vite (+ plantillas Pug) | `make build` |
| Tests unitarios | Vitest | `make test-unit` |
| Tests de integración | Vitest + puente simulado `ws` | `make test-integration` |
| Reglas de arquitectura | Vitest (`tests/architecture`) | `make test` |
| Imagen servible | Containerfile frontend | `make app-image` |
| E2E de navegador | Playwright + puente de desarrollo | `make e2e` / `make e2e-ci` |
| Todo lo anterior en contenedor | podman/docker | `make ci` |

## Gates opcionales o informativos

| Gate | Herramienta | Observaciones |
| --- | --- | --- |
| Cobertura ≥ 80 % (ramas ≥ 75 %) | @vitest/coverage-v8 | `make coverage`; parte de `just verify` |
| Secretos staged | gitleaks | en `pre-commit` si está instalado |
| Secretos en historial | trufflehog | en `pre-push` si está instalado |
| Documentación | MkDocs `--strict` | `make docs` |

## Política de falla

- Cualquier gate obligatorio en rojo bloquea el merge; no se desactivan
  tests para pasar CI.
- Quien abre el PR lo desbloquea; un fallo de infraestructura (registro de
  imágenes, runner) se reintenta y, si persiste, se documenta en el PR.
- No hay proceso de excepción aprobado.

## Relación con tareas

Un agente no debe marcar una tarea como `done` si `make ci` (o los gates de
la sección de validación de la tarea) no pasan.
