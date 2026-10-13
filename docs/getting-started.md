---
title: Guía de inicio
tags: [setup, container]
---

# Guía de inicio

## Requisitos

| Herramienta | Versión | Uso |
|-------------|---------|-----|
| Node.js | 24 LTS (`.nvmrc`) | desarrollo local |
| npm | incluido con Node | dependencias |
| make, just, bash | — | orquestación (regla 01) |
| podman (o docker) | — | CI y app en contenedor |
| uv (opcional) | — | `make docs` sin instalar MkDocs |

Navegador: Chromium 94+ (WebCodecs completo). Safari/Firefox recientes
funcionan si exponen `VideoEncoder`, `AudioEncoder` y `AudioWorklet`; la app
lo verifica al iniciar y explica qué falta.

## Local

```bash
just setup          # hooks + npm ci
just dev            # http://localhost:5173
```

## En contenedor

```bash
just up --port 8080 # construye la imagen y sirve en http://localhost:8080
just logs
just down
```

La imagen compila con Node.js 24 y sirve con nginx sin privilegios. Se publica
solo en `127.0.0.1`: `http://localhost` es contexto seguro y permite capturar
medios. Para exponerla en red, termina TLS delante (proxy/ingress).

## Probar contra un puente

1. Ten un puente que implemente el [protocolo v1](protocol.md) (en desarrollo
   puede ser `ws://localhost:<puerto>`).
2. En la UI: URL del puente, token (si aplica) y, opcionalmente, URL RTMPS +
   clave de stream.
3. Elige fuentes (cámara, micrófono, pantalla, audio del sistema) e inicia.
   El navegador te pedirá qué pestaña/ventana/pantalla compartir.

## Calidad

```bash
make lint test      # Biome + Vitest
make coverage       # umbral 80 %
make ci             # todo dentro del contenedor de CI (lo mismo que GitHub Actions)
```
