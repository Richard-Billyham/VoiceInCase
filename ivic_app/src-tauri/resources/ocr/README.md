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
```

The staged runtime is ignored by Git because it can be large. Keep this README
and the preparation script in source control, then rebuild the installer after
staging the runtime. Image OCR uses RapidOCR with ONNX Runtime, so the packaged
app does not require users to install Tesseract OCR.
