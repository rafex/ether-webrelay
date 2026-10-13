#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/logs.sh"
source "$SCRIPT_DIR/lib/messages.sh"

# ------------------------------------------------------------------
# Helper de contenedores — runtime, imágenes, CI y app en contenedor.
# Reutilizable por Makefile (helpers/mk/container.mk) y Justfile.
#
# Stack (regla 08): Podman primero, Docker con warning; Containerfile, nunca Dockerfile.
#
# Contrato de flags (regla 01):
#   --action runtime|image|ci|app-image|app-run|app-stop|app-logs
#   --project-name ether-webrelay
#   --container-runtime podman|docker   Sobreescribe la detección
#   --ci-image / --ci-containerfile     Imagen de CI (toolchain)
#   --app-image / --app-containerfile   Imagen servible del frontend
#   --app-name ether-webrelay           Nombre del contenedor en ejecución
#   --port 8080                         Puerto publicado en el host (solo 127.0.0.1)
#   --module source/frontend/nodejs/webrelay
#   --log-file /ruta/al/log  --log-level info  --man
#
# Auditoría: /var/log/<proyecto>/log-container-<ts>.log (fallback /tmp/<proyecto>)
# ------------------------------------------------------------------

action=""
container_runtime="${CONTAINER_RUNTIME:-}"
ci_image="ether-webrelay-ci:local"
ci_containerfile="containers/ci/Containerfile"
app_image="ether-webrelay:local"
app_containerfile="containers/frontend/Containerfile"
app_name="ether-webrelay"
port="8080"
module="source/frontend/nodejs/webrelay"
man="false"
WORKSPACE="${WORKSPACE:-$(pwd)}"

while [[ $# -gt 0 ]]; do
	case "$1" in
		--action)            action="${2:-}"; shift 2 ;;
		--project-name)      PROJECT_NAME="${2:-}"; shift 2 ;;
		--container-runtime) container_runtime="${2:-}"; shift 2 ;;
		--ci-image)          ci_image="${2:-}"; shift 2 ;;
		--ci-containerfile)  ci_containerfile="${2:-}"; shift 2 ;;
		--app-image)         app_image="${2:-}"; shift 2 ;;
		--app-containerfile) app_containerfile="${2:-}"; shift 2 ;;
		--app-name)          app_name="${2:-}"; shift 2 ;;
		--port)              port="${2:-}"; shift 2 ;;
		--module)            module="${2:-}"; shift 2 ;;
		--log-file)          LOG_FILE="${2:-}"; shift 2 ;;
		--log-level)         LOG_LEVEL="${2:-}"; shift 2 ;;
		--man)               man="true"; shift ;;
		*)                   echo "Unknown flag: $1" >&2; exit 1 ;;
	esac
done

if [[ "$man" == "true" ]]; then
	# Las acciones app-* se exponen como recetas de just (up/down/logs).
	case "$action" in
		app-run)  show_man "up" ;;
		app-stop) show_man "down" ;;
		app-logs) show_man "logs" ;;
		*)        show_man "${action:-ci}" ;;
	esac
	exit 0
fi
[[ -n "$action" ]] || { echo "Missing required flag --action" >&2; exit 1; }

init_log "container"

resolve_runtime() {
	if [[ -n "$container_runtime" ]]; then
		echo "$container_runtime"
	elif command -v podman >/dev/null 2>&1; then
		echo "podman"
	elif command -v docker >/dev/null 2>&1; then
		log_warn "Docker detectado. Podman es la opción recomendada según la regla 08-stack."
		echo "docker"
	else
		die "No container runtime found. Install podman (preferred) or docker."
	fi
}

runtime="$(resolve_runtime)"
log_info "Container runtime: $runtime"

require_file() {
	[[ -f "$WORKSPACE/$1" ]] || die "Missing $1"
}

build_image() {
	local containerfile="$1" image="$2"
	require_file "$containerfile"
	log_info "Building $image from $containerfile"
	local format=()
	# Podman produce OCI por defecto, que descarta HEALTHCHECK; el formato docker lo conserva.
	[[ "$runtime" == "podman" ]] && format=(--format docker)
	"$runtime" build "${format[@]}" -f "$WORKSPACE/$containerfile" -t "$image" "$WORKSPACE"
}

case "$action" in
	runtime)
		;;
	image)
		build_image "$ci_containerfile" "$ci_image"
		;;
	ci)
		build_image "$ci_containerfile" "$ci_image"
		# El árbol de trabajo entra por stdin (tar) en lugar de un bind-mount:
		#  - funciona con VMs de podman/docker que no comparten la ruta (macOS + volúmenes externos);
		#  - deja fuera node_modules/dist del host (binarios nativos de otra plataforma).
		# Solo la caché de npm persiste entre ejecuciones (volumen con nombre).
		log_info "Running containerized CI (install + lint + build + test)"
		COPYFILE_DISABLE=1 tar -C "$WORKSPACE" \
			--exclude=node_modules --exclude=dist --exclude=coverage --exclude=site \
			--exclude=.git --exclude=.specnative/.venv \
			-cf - . |
			"$runtime" run --rm -i \
				-v ether-webrelay-npm-cache:/root/.npm \
				-e CI=true \
				"$ci_image" \
				"mkdir -p /workspace && tar -xf - -C /workspace 2>/dev/null && cd /workspace && make install lint build test MODULE=$module"
		;;
	app-image)
		build_image "$app_containerfile" "$app_image"
		;;
	app-run)
		build_image "$app_containerfile" "$app_image"
		"$runtime" rm -f "$app_name" >/dev/null 2>&1 || true
		# Solo loopback: http://localhost es un contexto seguro para getUserMedia/getDisplayMedia.
		"$runtime" run -d --name "$app_name" -p "127.0.0.1:$port:8080" "$app_image" >/dev/null
		success "Ether WebRelay disponible en http://localhost:$port"
		;;
	app-stop)
		"$runtime" rm -f "$app_name" >/dev/null 2>&1 || true
		success "Contenedor $app_name detenido."
		;;
	app-logs)
		"$runtime" logs -f "$app_name"
		;;
	*)
		die "Unknown action: $action"
		;;
esac
