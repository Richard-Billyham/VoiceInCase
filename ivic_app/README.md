# InVoice InCase v2.1.x

IVIC v2.1.x is a local-first desktop invoice workbench rebuilt from the v2.1 PDR.
The old PyQt implementation remains in `invoice_manager` as a read-only reference; this app is the new Tauri 2 / React / TypeScript / Rust / SQLite line.

## Scope

- Dashboard with group-scoped statistics, amount hiding, reminders, and global search feedback.
- Form workspace for invoice/order records, filters, selection-gated actions, detail panel, and temporary matching mode.
- Single and batch import surfaces with preview-before-write behavior.
- Reimbursement batches with expandable child items, status context, and quick submit text.
- Reconciliation workbench with normal and matching modes, temporary selections, live amount difference, and abnormal difference handling.
- Group management with card list, details, title rules, and active state.
- Settings focused on local database path, attachment directory, backup/restore, theme, update opt-in, and app information.

## Architecture

```text
ivic_app/
  src/
    app/              React shell, navigation, sample data
    components/       Shared UI and data-table components
    pages/            Dashboard, forms, import, batches, reconciliation, groups, settings
    services/         Tauri invoke adapter with browser fallback
    styles/           InCase tokens and global desktop UI styles
    types/            Domain and DTO types
  src-tauri/
    src/
      commands/       Tauri commands
      db/             SQLite connection and migrations
      domain/         Status and reconciliation rules
      files/          Path safety, attachments, backup/restore
```

## Local Development

```bash
npm install
npm run dev
npm run build
npm run tauri dev
```

The browser dev mode uses `localStorage` as a safe fallback, while Tauri runtime calls Rust commands through `@tauri-apps/api/core`.

## Release Build With OCR

The packaged desktop app can bundle a local OCR runtime. Stage it before
building the installer:

```powershell
.\scripts\prepare_ocr_runtime.ps1 -CreateRuntime
npm run tauri build
```

The script creates or reuses `.ocr-runtime`, installs `ocr_requirements.txt`,
and copies `src-tauri/python/ivic_ocr` plus `ivic_invoice_layout.py` into
`src-tauri/resources/ocr/`. Image OCR uses RapidOCR with ONNX Runtime, so the
packaged app does not require users to install Tesseract OCR. That staged
runtime is ignored by Git but included by Tauri as installer resources.

## Product Baseline

Primary source: `invoice-incase/pdr-v2.1.x/ivic-v2.1-pdr.tex`.

Visual references:

- `invoice-incase/misc/new/*.png`
- `invoice-incase/misc/stylealike/*.png`
- `invoice-incase/docs/INCASE_STYLE_GUIDE.md`

The v2.0 PyQt screenshots are functional references and regression warnings, not visual targets.
