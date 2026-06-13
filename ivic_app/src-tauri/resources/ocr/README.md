# Bundled OCR Runtime

This directory is staged by `ivic_app/scripts/prepare_ocr_runtime.ps1` before a
release build.

Expected runtime layout:

```text
resources/ocr/
  python/                  Python runtime with OCR packages
  service/
    ivic_ocr/
      service.py
    ivic_invoice_layout.py
  tesseract/               Optional bundled Tesseract OCR runtime
```

The staged runtime is ignored by Git because it can be large. Keep this README
and the preparation script in source control, then rebuild the installer after
staging the runtime.
