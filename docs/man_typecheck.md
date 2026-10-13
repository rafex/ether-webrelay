# typecheck

## Nombre

typecheck — verifica tipos con TypeScript sin emitir archivos

## Sinopsis

```
make typecheck
make man TARGET=typecheck
```

## Descripción

Ejecuta `tsc --noEmit` para `tsconfig.json` (navegador) y `tsconfig.node.json` (Vite, plugin Pug y tests).

## Ejemplos

```bash
make typecheck
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
