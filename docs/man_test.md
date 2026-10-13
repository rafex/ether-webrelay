# test

## Nombre

test — ejecuta todos los tests (unitarios, integración y arquitectura)

## Sinopsis

```
make test
make man TARGET=test
```

## Descripción

Ejecuta Vitest en `MODULE/tests/`. Los unitarios cubren dominio y aplicación con fakes (sin red ni navegador); los de integración levantan un puente simulado con `ws` y usan el `WebSocket` real de Node; los de arquitectura validan las reglas del hexágono.

## Ejemplos

```bash
make test
make test-unit
make test-integration
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
