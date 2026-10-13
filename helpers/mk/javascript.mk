# Targets de construcción del frontend TypeScript (regla 01).
# Delegan en helpers/shell/javascript.sh; nunca ejecutan npm directamente.
JS_HELPER ?= helpers/shell/javascript.sh
JS_GOALS := install build typecheck test test-unit test-integration coverage lint format

.PHONY: $(JS_GOALS)

$(JS_GOALS):
	@bash "$(JS_HELPER)" --tool "$(BUILD_TOOL)" --goal "$@" --module "$(MODULE)"
