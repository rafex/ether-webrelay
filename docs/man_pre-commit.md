# pre-commit

## Nombre

pre-commit — gate de calidad del hook pre-commit

## Sinopsis

```
make pre-commit
make man TARGET=pre-commit
```

## Descripción

Lint, typecheck, gitleaks (si está instalado) y rechazo de archivos `.env` staged.

## Ejemplos

```bash
make pre-commit
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
