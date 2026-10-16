.PHONY: help

# Punto de entrada universal — solo construcción/artefactos (regla 01).
# La lógica vive en helpers/shell; los targets en helpers/mk/*.mk.
# Operativas del día a día → Justfile (just --list).

PROJECT_NAME ?= ether-webrelay
LANG ?= javascript
BUILD_TOOL ?= npm
MODULE ?= source/frontend/nodejs/webrelay
PROFILE ?= dev
SITE_DIR ?= site
MK_FILES ?= $(wildcard helpers/mk/*.mk)

export WORKSPACE := $(CURDIR)
export PROJECT_NAME

-include $(MK_FILES)

.DEFAULT_GOAL := help

help:
	@echo "Makefile — Construcción (build/artefactos) de $(PROJECT_NAME)"
	@echo "  make install           - Instalar dependencias (npm ci)"
	@echo "  make build             - Typecheck + build de producción (dist/)"
	@echo "  make test              - Tests unitarios + integración"
	@echo "  make test-unit         - Solo tests unitarios"
	@echo "  make test-integration  - Solo tests de integración"
	@echo "  make coverage          - Tests con cobertura (umbral 80%)"
	@echo "  make lint | format     - Biome"
	@echo "  make clean             - Limpiar artefactos"
	@echo "  make docs              - Sitio MkDocs en $(SITE_DIR)/"
	@echo ""
	@echo "  make runtime           - Detectar podman | docker"
	@echo "  make image             - Imagen de CI (containers/ci/Containerfile)"
	@echo "  make ci                - install + lint + build + test en contenedor"
	@echo "  make app-image         - Imagen servible (containers/frontend/Containerfile)"
	@echo "  make scan              - Trivy sobre la imagen servible (HIGH/CRITICAL corregibles)"
	@echo "  make audit             - npm audit de las dependencias de producción (HIGH+)"
	@echo ""
	@echo "  make pre-commit | pre-push   - Gates de git hooks"
	@echo "  make man TARGET=<tarea>      - Manual (docs/man_<tarea>.md)"
	@echo ""
	@echo "Variables: MODULE=$(MODULE) BUILD_TOOL=$(BUILD_TOOL)"
