# IVIC OCR Lab

把待测试的发票 PDF 或图片放到 `samples` 文件夹，然后在 `ivic_app` 目录运行：

```powershell
npm run ocr:test
```

脚本会调用和桌面应用一致的 OCR 链路：

1. `invoice_manager/extensions/ocr_service.py` 旧 OCR/解析模块
2. `ivic_app/src-tauri/python/ivic_invoice_layout.py` 坐标版式增强模块
3. 与 Tauri 命令相同的字段合并规则

每次运行会在 `logs` 文件夹生成：

- `ocr_report_YYYYMMDD-HHMMSS.md`
- `ocr_report_YYYYMMDD-HHMMSS.json`
- `latest.md`
- `latest.json`

Markdown 日志适合快速看问题，JSON 日志保留完整旧 OCR、坐标增强和最终合并结果，方便继续调整模板规则。
