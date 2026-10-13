#!/usr/bin/env bash
# pre-commit.sh — Gate de calidad (construcción → Makefile).
# Llamado por make pre-commit → pre-commit.mk.
# Orquesta scripts atómicos: lint del frontend, typecheck, secretos.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/logs.sh"
source "$SCRIPT_DIR/lib/messages.sh"
init_log "pre-commit"

module="${MODULE:-source/frontend/nodejs/webrelay}"

step 1 4 "Lint (Biome)..."
bash "$SCRIPT_DIR/javascript.sh" --goal lint --module "$module" || die "lint falló"

step 2 4 "Typecheck (TypeScript)..."
bash "$SCRIPT_DIR/javascript.sh" --goal typecheck --module "$module" || die "typecheck falló"

step 3 4 "Verificación de secretos..."
if command -v gitleaks >/dev/null 2>&1; then
	gitleaks git --staged
	log_info "gitleaks: sin secretos detectados."
else
	log_info "gitleaks no instalado — verificación saltada."
fi

step 4 4 "Doble-check de .env y secretos en plano..."
staged_env="$(git diff --cached --name-only | grep -E '(^|/)(\.env$|\.env\.[a-z]+$)' || true)"
for f in $staged_env; do
	case "$f" in
		*.env.example) continue ;;
	esac
	die "Archivo .env staged ($f). Los secretos no se versionan."
done

success "pre-commit superado."
