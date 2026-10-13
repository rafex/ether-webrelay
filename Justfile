# Justfile — task manager de operativas (regla 01). No es proxy de make:
# las recetas componen pasos o capturan parámetros y delegan en helpers/.
# Construcción/artefactos → Makefile (make help).

set dotenv-load

module := env_var_or_default("MODULE", "source/frontend/nodejs/webrelay")
tool := env_var_or_default("BUILD_TOOL", "npm")

# Listar operativas disponibles
@default:
    just --list

import 'helpers/just/app.just'
import 'helpers/just/hooks.just'

# Preparar el entorno local: dependencias + git hooks
setup:
    bash helpers/shell/hooks.sh install
    bash helpers/shell/javascript.sh --tool {{tool}} --goal install --module {{module}}

# Gate completo local antes de abrir un PR: lint + build + tests + cobertura
verify:
    make lint
    make build
    make coverage
