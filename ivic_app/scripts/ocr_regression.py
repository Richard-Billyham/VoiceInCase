from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any


APP_DIR = Path(__file__).resolve().parents[1]
WORKSPACE_DIR = APP_DIR.parent
LEGACY_DIR = WORKSPACE_DIR / "invoice_manager"
LAYOUT_DIR = APP_DIR / "src-tauri" / "python"
DEFAULT_SAMPLE_DIR = APP_DIR / "ocr_lab" / "samples"
DEFAULT_LOG_DIR = APP_DIR / "ocr_lab" / "logs"
SUPPORTED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}

FORCE_LAYOUT_KEYS = {
    "buyer_name",
    "buyer_tax_no",
    "seller_name",
    "seller_tax_no",
    "description",
}

FINAL_FIELDS = [
    "invoice_number",
    "issue_date",
    "buyer_name",
    "buyer_tax_no",
    "seller_name",
    "seller_tax_no",
    "item_name",
    "spec_model",
    "unit",
    "quantity",
    "amount_without_tax",
    "tax_amount",
    "amount",
    "description",
]

FIELD_LABELS = {
    "invoice_number": "票号",
    "issue_date": "开票日期",
    "buyer_name": "购买方名称",
    "buyer_tax_no": "购买方税号",
    "seller_name": "销售方名称",
    "seller_tax_no": "销售方税号",
    "item_name": "首个项目名称",
    "spec_model": "规格型号",
    "unit": "单位",
    "quantity": "数量",
    "amount_without_tax": "合计",
    "tax_amount": "税额",
    "amount": "价税合计",
    "description": "发票备注",
}

CRITICAL_FIELDS = [
    "invoice_number",
    "issue_date",
    "buyer_name",
    "buyer_tax_no",
    "seller_name",
    "seller_tax_no",
    "item_name",
    "amount_without_tax",
    "tax_amount",
    "amount",
]


def main() -> int:
    args = parse_args()
    sample_dir = Path(args.samples).resolve()
    log_dir = Path(args.logs).resolve()
    sample_dir.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)

    maybe_reexec_with_legacy_venv()
    add_import_paths()

    from extensions.ocr_service import format_ocr_environment_status, parse_invoice_file

    try:
        from ivic_invoice_layout import parse_invoice_layout_file
    except Exception:
        parse_invoice_layout_file = None

    started_at = datetime.now()
    files = [Path(item).resolve() for item in args.file] if args.file else find_invoice_files(sample_dir)
    results = []

    for file_path in files:
        results.append(
            inspect_invoice(
                file_path=file_path,
                sample_dir=sample_dir,
                parse_invoice_file=parse_invoice_file,
                parse_invoice_layout_file=parse_invoice_layout_file,
            )
        )

    report = {
        "startedAt": started_at.isoformat(timespec="seconds"),
        "workspace": str(WORKSPACE_DIR),
        "sampleDir": str(sample_dir),
        "logDir": str(log_dir),
        "python": sys.executable,
        "environment": format_ocr_environment_status(),
        "supportedSuffixes": sorted(SUPPORTED_SUFFIXES),
        "fileCount": len(files),
        "results": results,
    }

    stamp = started_at.strftime("%Y%m%d-%H%M%S")
    json_path = log_dir / f"ocr_report_{stamp}.json"
    md_path = log_dir / f"ocr_report_{stamp}.md"
    latest_json_path = log_dir / "latest.json"
    latest_md_path = log_dir / "latest.md"

    json_text = json.dumps(report, ensure_ascii=False, indent=2)
    md_text = render_markdown(report)
    json_path.write_text(json_text, encoding="utf-8")
    md_path.write_text(md_text, encoding="utf-8")
    latest_json_path.write_text(json_text, encoding="utf-8")
    latest_md_path.write_text(md_text, encoding="utf-8")

    print(f"OCR samples: {len(files)}")
    print(f"Markdown log: {md_path}")
    print(f"JSON log: {json_path}")

    issue_count = sum(len(item.get("issues", [])) for item in results)
    if args.fail_on_issues and issue_count:
        return 1
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run IVIC OCR regression checks against invoice samples.",
    )
    parser.add_argument(
        "--samples",
        default=str(DEFAULT_SAMPLE_DIR),
        help="Folder containing invoice PDFs/images. Defaults to ivic_app/ocr_lab/samples.",
    )
    parser.add_argument(
        "--logs",
        default=str(DEFAULT_LOG_DIR),
        help="Folder for generated Markdown and JSON logs. Defaults to ivic_app/ocr_lab/logs.",
    )
    parser.add_argument(
        "--file",
        action="append",
        default=[],
        help="Run one specific invoice file. Can be provided more than once.",
    )
    parser.add_argument(
        "--fail-on-issues",
        action="store_true",
        help="Exit with code 1 when any sample has missing or suspicious fields.",
    )
    return parser.parse_args()


def maybe_reexec_with_legacy_venv() -> None:
    if os.environ.get("IVIC_OCR_REGRESSION_REEXEC") == "1":
        return

    try:
        import fitz  # noqa: F401

        return
    except ImportError:
        pass

    venv_python = LEGACY_DIR / ".venv" / "Scripts" / "python.exe"
    if not venv_python.exists():
        return

    current = Path(sys.executable).resolve()
    target = venv_python.resolve()
    if current == target:
        return

    env = os.environ.copy()
    env["IVIC_OCR_REGRESSION_REEXEC"] = "1"
    env.setdefault("PYTHONUTF8", "1")
    env.setdefault("PYTHONIOENCODING", "utf-8")
    os.execve(str(target), [str(target), *sys.argv], env)


def add_import_paths() -> None:
    for path in (str(LEGACY_DIR), str(LAYOUT_DIR)):
        if path not in sys.path:
            sys.path.insert(0, path)


def find_invoice_files(sample_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in sample_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
    )


def safe_relative_path(file_path: Path, base_dir: Path) -> str:
    try:
        return str(file_path.relative_to(base_dir))
    except ValueError:
        return str(file_path)


def inspect_invoice(
    file_path: Path,
    sample_dir: Path,
    parse_invoice_file,
    parse_invoice_layout_file,
) -> dict[str, Any]:
    started = time.perf_counter()
    relative_path = safe_relative_path(file_path, sample_dir)
    legacy_result: dict[str, Any] = {}
    layout_result: dict[str, Any] = {}
    merged_result: dict[str, Any] = {}
    sources: dict[str, str] = {}
    errors: list[str] = []

    try:
        legacy_result = parse_invoice_file(str(file_path)) or {}
    except Exception as exc:
        errors.append(f"legacy OCR error: {exc}")

    if parse_invoice_layout_file is None:
        errors.append("layout parser unavailable")
    else:
        try:
            layout_result = parse_invoice_layout_file(file_path) or {}
        except Exception as exc:
            errors.append(f"layout parser error: {exc}")

    merged_result, sources = merge_app_ocr_result(legacy_result, layout_result)
    issues, notes = diagnose_result(merged_result, legacy_result, layout_result, errors)
    duration_ms = round((time.perf_counter() - started) * 1000)

    return {
        "file": relative_path,
        "absolutePath": str(file_path),
        "status": "error" if errors else "ok",
        "durationMs": duration_ms,
        "errors": errors,
        "issues": issues,
        "notes": notes,
        "final": keep_fields(merged_result, FINAL_FIELDS),
        "fieldSources": {key: sources.get(key, "") for key in FINAL_FIELDS},
        "legacy": make_json_safe(legacy_result),
        "layout": make_json_safe(layout_result),
    }


def merge_app_ocr_result(
    legacy_result: dict[str, Any],
    layout_result: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    data = dict(legacy_result or {})
    sources = {
        key: "legacy"
        for key, value in data.items()
        if not is_blank(value)
    }

    for key, value in (layout_result or {}).items():
        if is_blank(value):
            continue
        current = data.get(key)
        if key in FORCE_LAYOUT_KEYS:
            data[key] = value
            sources[key] = "layout" if is_blank(current) else "layout_override"
        elif is_blank(current):
            data[key] = value
            sources[key] = "layout_fill"

    return data, sources


def diagnose_result(
    final: dict[str, Any],
    legacy: dict[str, Any],
    layout: dict[str, Any],
    errors: list[str],
) -> tuple[list[str], list[str]]:
    issues = list(errors)
    notes = []

    missing = [FIELD_LABELS[field] for field in CRITICAL_FIELDS if is_blank(final.get(field))]
    if missing:
        issues.append("缺少关键字段：" + "、".join(missing))

    for field in ("buyer_tax_no", "seller_tax_no"):
        value = final.get(field)
        if not is_blank(value) and not looks_like_tax_no(value):
            issues.append(f"{FIELD_LABELS[field]}格式可疑：{value}")

    if same_nonblank(final.get("buyer_tax_no"), final.get("seller_tax_no")):
        issues.append("购买方税号和销售方税号相同，需人工确认")
    if same_nonblank(final.get("buyer_name"), final.get("seller_name")):
        issues.append("购买方名称和销售方名称相同，需人工确认")

    subtotal = to_float(final.get("amount_without_tax"))
    tax = to_float(final.get("tax_amount"))
    total = to_float(final.get("amount"))
    if subtotal is not None and tax is not None and total is not None:
        if abs((subtotal + tax) - total) > 0.03:
            issues.append(
                f"金额勾稽不一致：合计 {subtotal} + 税额 {tax} != 价税合计 {total}"
            )

    invoice_number = str(final.get("invoice_number") or "")
    if invoice_number and not re.fullmatch(r"[0-9A-Z]{8,24}", invoice_number):
        issues.append(f"票号格式可疑：{invoice_number}")

    if legacy and layout:
        for field in ("buyer_tax_no", "seller_tax_no", "buyer_name", "seller_name"):
            if is_blank(legacy.get(field)) and not is_blank(layout.get(field)):
                notes.append(f"{FIELD_LABELS[field]}由坐标增强补齐")

    return issues, notes


def keep_fields(data: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    return {field: make_json_safe(data.get(field, "")) for field in fields}


def make_json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): make_json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [make_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [make_json_safe(item) for item in value]
    return value


def is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    return False


def looks_like_tax_no(value: Any) -> bool:
    return re.fullmatch(r"[0-9A-Z]{12,24}", str(value or "").strip().upper()) is not None


def same_nonblank(left: Any, right: Any) -> bool:
    if is_blank(left) or is_blank(right):
        return False
    return str(left).strip() == str(right).strip()


def to_float(value: Any) -> float | None:
    if is_blank(value):
        return None
    try:
        return float(str(value).replace(",", "").replace("¥", "").replace("￥", "").strip())
    except ValueError:
        return None


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# IVIC OCR 回归测试报告",
        "",
        f"- 时间：{report['startedAt']}",
        f"- Python：`{report['python']}`",
        f"- 样本目录：`{report['sampleDir']}`",
        f"- OCR 环境：{escape_md(report['environment'])}",
        f"- 样本数量：{report['fileCount']}",
        "",
    ]

    if report["fileCount"] == 0:
        lines.extend(
            [
                "## 没有样本",
                "",
                "把 PDF 或图片发票放进样本目录后重新运行脚本。",
                "",
            ]
        )
        return "\n".join(lines)

    lines.extend(
        [
            "## 总览",
            "",
            "| 文件 | 状态 | 问题数 | 票号 | 购买方税号 | 销售方税号 | 用时 |",
            "| --- | --- | ---: | --- | --- | --- | ---: |",
        ]
    )
    for item in report["results"]:
        final = item["final"]
        lines.append(
            "| "
            + " | ".join(
                [
                    escape_md(item["file"]),
                    item["status"],
                    str(len(item["issues"])),
                    escape_md(final.get("invoice_number")),
                    escape_md(final.get("buyer_tax_no")),
                    escape_md(final.get("seller_tax_no")),
                    f"{item['durationMs']} ms",
                ]
            )
            + " |"
        )

    for item in report["results"]:
        final = item["final"]
        lines.extend(
            [
                "",
                f"## {escape_md(item['file'])}",
                "",
                f"- 状态：{item['status']}",
                f"- 用时：{item['durationMs']} ms",
                "",
                "### 问题",
                "",
            ]
        )
        if item["issues"]:
            lines.extend(f"- {escape_md(issue)}" for issue in item["issues"])
        else:
            lines.append("- 未发现明显问题")

        lines.extend(
            [
                "",
                "### 识别备注",
                "",
            ]
        )
        if item.get("notes"):
            lines.extend(f"- {escape_md(note)}" for note in item["notes"])
        else:
            lines.append("- 无")

        lines.extend(
            [
                "",
                "### 最终字段",
                "",
                "| 字段 | 值 | 来源 | 旧 OCR | 坐标增强 |",
                "| --- | --- | --- | --- | --- |",
            ]
        )
        for field in FINAL_FIELDS:
            lines.append(
                "| "
                + " | ".join(
                    [
                        FIELD_LABELS[field],
                        escape_md(final.get(field)),
                        escape_md(item["fieldSources"].get(field)),
                        escape_md(item["legacy"].get(field)),
                        escape_md(item["layout"].get(field)),
                    ]
                )
                + " |"
            )

    lines.append("")
    return "\n".join(lines)


def escape_md(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    text = text.replace("\r\n", " ").replace("\n", " ")
    text = text.replace("|", "\\|")
    return text.strip()


if __name__ == "__main__":
    raise SystemExit(main())
