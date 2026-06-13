# IVIC OCR Lab

Use this folder as the OCR regression testbench while refactoring OCR.

Place invoice PDFs or images in `samples`, then run from `ivic_app`:

```powershell
npm run ocr:test
```

The script should exercise the same OCR chain used by the desktop app:

1. `src-tauri/python/ivic_ocr` for OCR and invoice text parsing
2. `src-tauri/python/ivic_invoice_layout.py` for PDF layout-assisted parsing
3. The same field merge rules used by the Tauri command

Each run writes logs to `logs`:

- `ocr_report_YYYYMMDD-HHMMSS.md`
- `ocr_report_YYYYMMDD-HHMMSS.json`
- `latest.md`
- `latest.json`

Use the Markdown log for quick inspection and the JSON log for detailed sample
analysis. Continue testing, logging, and analyzing here until OCR refactoring is
stable.
