# Optional convenience shortcuts. `make` is NOT a dependency of this project —
# every target here is a one-line wrapper around a stdlib Python script you can
# run directly, which is what the docs and the skill tell you to do. Kept only
# because `make start` is less to type.

PYTHON ?= $(shell for p in "$${DATA_APPS_PYTHON}" python3 python; do [ -n "$$p" ] && "$$p" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >/dev/null 2>&1 && { echo "$$p"; exit 0; }; done; py_out=$$(py -3 -c "import sys; print(sys.executable.replace('\\\\', '/')) if sys.version_info >= (3, 9) else sys.exit(1)" 2>/dev/null | tr -d '\r'); echo "$${py_out:-python3}")

.PHONY: help start stop verify

help:
	@echo 'Optional shortcuts (all equivalent to running the script directly):'
	@echo '  make start [ARGS=apps/<name>/app.js]   python3 preview-server/serve.py'
	@echo '  make stop                              python3 skills/data-app-previewer/tools/stop-preview.py'
	@echo '  make verify                            python3 scripts/verify-install.py'

start:
	"$(PYTHON)" preview-server/serve.py $(ARGS)

stop:
	"$(PYTHON)" skills/data-app-previewer/tools/stop-preview.py

verify:
	"$(PYTHON)" scripts/verify-install.py
