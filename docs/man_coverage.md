# coverage

## Nombre

coverage — tests con reporte de cobertura

## Sinopsis

```
make coverage
make man TARGET=coverage
```

## Descripción

Ejecuta Vitest con cobertura v8 sobre dominio, aplicación y transporte. Falla si baja de 80 % en líneas, funciones y sentencias (75 % en ramas). Reporte en `MODULE/coverage/`.

## Ejemplos

```bash
make coverage
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
