# COMMANDS.md

Comandos operativos del proyecto. Todos delegan en `helpers/shell/*.sh`;
cada uno tiene manual: `make man TARGET=<tarea>` o `just <receta> --man`.

## Setup

```bash
just setup                 # git hooks (.githooks) + npm ci
make install               # solo dependencias (npm ci)
```

## Desarrollo

```bash
just bridge-dev            # puente de desarrollo: señalización v2 + mini SFU (ws://localhost:8090/signal)
just dev                   # Vite en http://localhost:5173/join/demo?t=dev (--port N)
just preview               # build + vite preview en :4173
just up                    # imagen + contenedor en http://localhost:8080 (--port N, --bridge-url URL, --view …)
just logs
just down
```

## Tests

```bash
make test                  # unit + integración + arquitectura
make test-unit
make test-integration
make coverage              # umbral 80 %
make e2e                   # Playwright: lobby + llamada real (Chrome instalado si existe)
make e2e-ci                # E2E dentro de la imagen de Playwright
```

## Lint y formato

```bash
make lint                  # biome check
make format                # biome format --write
make typecheck             # tsc --noEmit
```

## Build

```bash
make build                 # typecheck + vite build → source/frontend/nodejs/webrelay/dist
make app-image             # imagen servible ether-webrelay:local
make clean
```

## CI y contenedores

```bash
make runtime               # podman | docker
make image                 # imagen de CI
make ci                    # install + lint + build + test dentro del contenedor
```

## Utilidad

```bash
make docs                  # sitio MkDocs en site/ (mkdocs o uvx)
make pre-commit            # gate de hooks: lint + typecheck + secretos
make pre-push              # gate de hooks: tests + trufflehog
just verify                # lint + build + coverage antes de un PR
```
