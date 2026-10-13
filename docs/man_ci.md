# ci

## Nombre

ci — pipeline completo dentro de un contenedor

## Sinopsis

```
make ci
make man TARGET=ci
```

## Descripción

Construye la imagen de CI y ejecuta `make install lint build test` dentro del contenedor. El árbol de trabajo entra por `tar` en stdin (sin bind-mount): funciona con VMs de podman/docker que no comparten la ruta del repositorio (macOS con volúmenes externos) y excluye `node_modules`/`dist` del host. Solo la caché de npm persiste (volumen `ether-webrelay-npm-cache`). Es exactamente lo que ejecuta GitHub Actions.

## Ejemplos

```bash
make ci
make ci CONTAINER_RUNTIME=docker
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
