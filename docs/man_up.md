# up

## Nombre

up — levanta el frontend en un contenedor

## Sinopsis

```
just up [--port 8080] [--bridge-url URL] [--relay-url URL] [--transport webrtc|websocket] [--view stage|minimal|stats] [--effects-model-url URL] [--man]
make man TARGET=up
```

## Descripción

Construye la imagen servible (`containers/frontend/Containerfile`) y la ejecuta con el runtime detectado (podman → docker), publicada solo en `127.0.0.1:<port>`. Abre `http://localhost:<port>/join/<sala>?t=<token>`. Las opciones `--bridge-url`, `--relay-url`, `--transport`, `--view` y `--effects-model-url` se pasan como variables `WEBRELAY_*` y el contenedor genera `config.json` al arrancar. Para exponerla fuera de localhost hace falta terminar TLS delante (proxy/ingress): los navegadores solo permiten capturar medios en contextos seguros.

## Ejemplos

```bash
just up
just up --port 8091
just up --bridge-url wss://puente.example.com/signal --view stats
just down
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
