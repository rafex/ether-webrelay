#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/logs.sh"
source "$SCRIPT_DIR/lib/messages.sh"

# ------------------------------------------------------------------
# Helper de JavaScript/TypeScript — install, build, test, lint, serve.
# Reutilizable por Makefile (helpers/mk/javascript.mk) y Justfile.
#
# Contrato de flags (regla 01):
#   --tool npm|pnpm                     Gestor de paquetes (default: npm)
#   --goal <goal>                       install | build | typecheck | test |
#                                       test-unit | test-integration | coverage |
#                                       lint | format | dev | preview | bridge-dev
#   --module source/frontend/nodejs/webrelay   Proyecto (default: .)
#   --port 5173                         Puerto (dev/preview)
#   --host localhost                    Host (dev/preview)
#   --command "<cmd>"                   Comando directo (sobreescribe goal)
#   --log-file /ruta/al/log             Auditoría (default: /var/log|/tmp/<proyecto>)
#   --log-level info                    (opcional)
#   --man                               Muestra docs/man_<goal>.md y termina
#
# Auditoría: /var/log/<proyecto>/log-javascript-<ts>.log
#             Fallback → /tmp/<proyecto>/log-javascript-<ts>.log
# ------------------------------------------------------------------

tool="npm"
goal=""
module="."
port="5173"
host="localhost"
command_line=""
man="false"
WORKSPACE="${WORKSPACE:-$(pwd)}"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--tool)      tool="${2:-}"; shift 2 ;;
		--goal)      goal="${2:-}"; shift 2 ;;
		--module)    module="${2:-}"; shift 2 ;;
		--port)      port="${2:-}"; shift 2 ;;
		--host)      host="${2:-}"; shift 2 ;;
		--command)   command_line="${2:-}"; shift 2 ;;
		--log-file)  LOG_FILE="${2:-}"; shift 2 ;;
		--log-level) LOG_LEVEL="${2:-}"; shift 2 ;;
		--man)       man="true"; shift ;;
		*)           echo "Unknown flag: $1" >&2; exit 1 ;;
	esac
done

# --man se resuelve antes de init_log (regla 01): mostrar un manual no se audita.
if [[ "$man" == "true" ]]; then
	show_man "${goal:-javascript}"
	exit 0
fi

if [[ -n "$command_line" ]]; then goal=""; fi
if [[ -z "$goal" && -z "$command_line" ]]; then
	echo "Missing required flag --goal or --command" >&2
	exit 1
fi

init_log "javascript"
log_info "Tool: $tool | Goal: ${goal:-<command>} | Module: $module"

resolve_cmd() {
	local run
	case "$tool" in
		npm)  run="npm run" ;;
		pnpm) run="pnpm run" ;;
		*)    die "Unknown tool: $tool. Expected npm|pnpm" ;;
	esac
	case "$goal" in
		install)
			# ci: instalación reproducible desde el lockfile.
			if [[ "$tool" == "npm" ]]; then echo "npm ci --no-audit --no-fund"; else echo "pnpm install --frozen-lockfile"; fi ;;
		build|typecheck|lint|format|coverage|test-unit|test-integration)
			echo "$run $goal" ;;
		test)    echo "$run test" ;;
		dev)     echo "$run dev -- --host $host --port $port" ;;
		preview) echo "$run preview -- --host $host --port $port" ;;
		# Puente de desarrollo (doble de prueba, no publica RTMPS).
		bridge-dev) echo "$run bridge:dev -- --port ${port}" ;;
		*)       echo "" ;;
	esac
}

if [[ -n "$command_line" ]]; then
	cmd="$command_line"
else
	cmd="$(resolve_cmd)"
	[[ -n "$cmd" ]] || die "Unknown goal: $goal"
fi

cd "$WORKSPACE/$module"
log_info "Executing: $cmd (in $module)"
bash -c "$cmd"
