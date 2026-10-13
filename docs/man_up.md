# up

## Nombre

up — levanta el frontend en un contenedor

## Sinopsis

```
just up [--port 8080] [--man]
make man TARGET=up
```

## Descripción

Construye la imagen servible (`containers/frontend/Containerfile`) y la ejecuta con el runtime detectado (podman → docker), publicada solo en `127.0.0.1:<port>`. Abre `http://localhost:<port>`. Para exponerla fuera de localhost hace falta terminar TLS delante (proxy/ingress): los navegadores solo permiten capturar medios en contextos seguros.

## Ejemplos

```bash
just up
just up --port 8091
just down
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
