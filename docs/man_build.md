# build

## Nombre

build — typecheck + build de producción del frontend

## Sinopsis

```
make build [MODULE=<ruta>]
make man TARGET=build
```

## Descripción

Delega en `javascript.sh --goal build` → `npm run build`: `tsc --noEmit` sobre `src/` y la configuración de Vite, y después `vite build`. Las plantillas Pug se renderizan durante el build (plugin `build/vite-plugin-pug.ts`). Salida en `MODULE/dist/`; ffmpeg.wasm queda como asset separado y se descarga solo al exportar OGV.

## Ejemplos

```bash
make build
bash helpers/shell/javascript.sh --goal build --module source/frontend/nodejs/webrelay
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
