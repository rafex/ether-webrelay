# test-integration

## Nombre

test-integration — ejecuta solo los tests de integración

## Sinopsis

```
make test-integration
make man TARGET=test-integration
```

## Descripción

Vitest sobre `tests/integration/`: flujo completo sobre un WebSocket real contra `tests/support/mock-bridge.ts`, y render de las plantillas Pug reales.

## Ejemplos

```bash
make test-integration
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
