# Targets de contenedor (reglas 06 y 08): podman → docker, Containerfile.
.PHONY: runtime image ci app-image scan e2e-ci

CONTAINER_HELPER ?= helpers/shell/container.sh
CONTAINER_RUNTIME ?=
CI_IMAGE ?= ether-webrelay-ci:local
CI_CONTAINERFILE ?= containers/ci/Containerfile
APP_IMAGE ?= ether-webrelay:local
APP_CONTAINERFILE ?= containers/frontend/Containerfile
E2E_IMAGE ?= ether-webrelay-e2e:local
E2E_CONTAINERFILE ?= containers/e2e/Containerfile

CONTAINER_FLAGS = --project-name "$(PROJECT_NAME)" --container-runtime "$(CONTAINER_RUNTIME)" \
	--ci-image "$(CI_IMAGE)" --ci-containerfile "$(CI_CONTAINERFILE)" \
	--app-image "$(APP_IMAGE)" --app-containerfile "$(APP_CONTAINERFILE)" \
	--e2e-image "$(E2E_IMAGE)" --e2e-containerfile "$(E2E_CONTAINERFILE)" --module "$(MODULE)"

runtime image ci app-image scan e2e-ci:
	@bash "$(CONTAINER_HELPER)" --action "$@" $(CONTAINER_FLAGS)
