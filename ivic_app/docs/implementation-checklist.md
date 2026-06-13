# IVIC v2.1 Implementation Checklist

## PDR Coverage

- [x] New code lives under `ivic_app`.
- [x] Old `invoice_manager` is treated as read-only reference.
- [x] React desktop shell with left navigation, top toolbar, main work area, right detail panels, and bottom status bar.
- [x] InCase token set: warm paper background, walnut primary, dark green action color, hard borders, hard shadows.
- [x] Dashboard statistics, amount hiding, reminders, and search result mode.
- [x] Form management filters, selection-gated actions, sortable table, detail panel, and temporary matching mode.
- [x] Group management card list plus right-side editable detail.
- [x] Settings page hides server-style database configuration.
- [x] Frontend service boundary wraps Tauri commands instead of scattering invoke calls in pages.
- [ ] Full OCR parser.
- [ ] School/finance export template selection.
- [ ] Explicit Tag/Category management UI.
- [ ] Production-grade PDF renderer.

## Backend Coverage

- [x] Planned Rust command boundary for settings, forms, groups, batches, transactions, backup.
- [x] SQLite migration scope includes PDR v2.1 core tables.
- [x] Path-safety and backup/restore modules are part of the target structure.
- [ ] Exhaustive migration from old PyQt SQLite data.
- [ ] Unit tests for status aggregation and reconciliation amount rules.

## Acceptance Notes

The first construction pass is a functional scaffold rather than a packaged release. Before calling a release complete, run:

```bash
npm run build
cargo fmt
cargo test
npm run tauri dev
```

Then capture desktop and narrow-window screenshots for:

- Dashboard
- Form management
- Form matching mode
- Single import
- Batch import
- Batch submission
- Reconciliation normal mode
- Reconciliation matching mode
- Group management
- Settings
