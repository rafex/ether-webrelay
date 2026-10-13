---
title: Guía de inicio
tags: [setup, container]
---

# Guía de inicio

Guía operativa completa (puertos, contenedor, TLS, problemas comunes):
[Levantar el frontend](running-frontend.md).

## Requisitos

| Herramienta | Versión | Uso |
|-------------|---------|-----|
| Node.js | 24 LTS (`.nvmrc`) | desarrollo local |
| npm | incluido con Node | dependencias |
| make, just, bash | — | orquestación (regla 01) |
| podman (o docker) | — | CI, E2E y app en contenedor |
| uv (opcional) | — | `make docs` sin instalar MkDocs |

Navegador: Chromium, Safari o Firefox recientes con WebRTC. El modo
alternativo `websocket` requiere además WebCodecs y AudioWorklet; la app lo
verifica al iniciar y explica qué falta.

## Probar la videollamada en local

```bash
just setup          # hooks + npm ci
just bridge-dev     # puente de desarrollo en ws://localhost:8090/signal
just dev            # app en http://localhost:5173
```

Abre `http://localhost:5173/join/demo?t=dev` en dos ventanas (o perfiles):
verás el lobby con la sala del puente, entrarás con tu nombre y cada ventana
verá y oirá a la otra.

## En contenedor

```bash
just up --port 8080 # http://localhost:8080/join/demo?t=dev
just logs
just down
```

Para apuntar a un puente real: `just up --bridge-url wss://puente.example.com/signal`.
Se publica solo en `127.0.0.1`; para exponerla en red, termina TLS delante.

## Contra el puente real

El puente vive en
[`ether-streaming-culerin`](https://github.com/rafex/ether-streaming-culerin)
e implementa la [señalización v2](signaling.md). El organizador genera el
enlace `/join/<sala>?t=<token>`; `bridgeUrl` en `config.json` (o
`WEBRELAY_BRIDGE_URL`) apunta a su señalización.

## Calidad

```bash
make lint test      # Biome + Vitest
make coverage       # umbral 80 %
make e2e            # Playwright: lobby + llamada real entre dos participantes
make ci             # todo dentro del contenedor de CI (lo mismo que GitHub Actions)
make e2e-ci         # E2E dentro de la imagen de Playwright
```
