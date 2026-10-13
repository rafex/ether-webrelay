# install

## Nombre

install — instala las dependencias del frontend de forma reproducible

## Sinopsis

```
make install [BUILD_TOOL=npm|pnpm] [MODULE=<ruta>]
make man TARGET=install
```

## Descripción

Delega en `helpers/shell/javascript.sh --goal install`, que ejecuta `npm ci` (o `pnpm install --frozen-lockfile`) dentro de `MODULE`. Usa el lockfile versionado; nunca actualiza dependencias.

## Ejemplos

```bash
make install
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
