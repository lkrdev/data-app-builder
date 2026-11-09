# payload

## Overview
Distributable Looker Data Apps runtime payload packaged into customer tarballs (`looker-data-apps.tar.gz`), containing the browser Lit runtime, vendored third-party libraries, local preview server, setup/verification scripts, bundled skills, and `Makefile` convenience shortcuts.

## Subdirectories & Boundaries
- [preview-server](./preview-server/EGM.md) - Local `ThreadingHTTPServer` (`serve.py`), `<preview-host>` gallery/sandbox shell, and `/api/query` Looker proxy.
- [runtime](./runtime/EGM.md) - Core `data-app.js` LitElement runtime (`DataApp`, `AppWidget`, `<app-kpi>`, `<app-chart>`, `<app-grid>`, `<app-select>`) and `data-app.css` stylesheet.
- [scripts](./scripts/EGM.md) - Environment setup (`bootstrap.sh`), config consolidation (`configs-merger.sh`), and Looker inline-extension verification (`verify-install.py`).
- [skills](./skills/EGM.md) - Skill packages and Python/Bash CLI tools for authoring, previewing, publishing, upgrading, and updating Data Apps.
- [vendor](./vendor/EGM.md) - Vendored browser dependencies (`ag-grid` `31.3.4`, `highcharts` `11.4.8`, `lit` `3.3.1`, `@looker/extension-sdk` `24.20.0`).
