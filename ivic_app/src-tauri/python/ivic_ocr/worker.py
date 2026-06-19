"""Long-lived OCR worker for IVIC.

The desktop app talks to this process with one JSON request per line on stdin
and one JSON response per line on stdout. Keeping the process alive avoids
reloading RapidOCR/ONNX models for every image.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


service_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
sys.path.insert(0, str(service_dir))

from ivic_ocr.service import format_ocr_environment_status, parse_invoice_file, recognize_invoice_file

try:
    from ivic_invoice_layout import parse_invoice_layout_file
except Exception:
    def parse_invoice_layout_file(_file_path):
        return {}


def merge_layout_result(data, layout_data):
    for key, value in (layout_data or {}).items():
        if value in (None, ""):
            continue
        if key in {"buyer_name", "buyer_tax_no", "seller_name", "seller_tax_no", "description"}:
            data[key] = value
        elif data.get(key) in (None, ""):
            data[key] = value
    return data


def invoice_empty_result(message):
    return {
        "ok": False,
        "message": message,
        "rawText": "",
        "invoiceNumber": "",
        "invoiceType": "",
        "issueDate": "",
        "buyerName": "",
        "buyerTaxNo": "",
        "sellerName": "",
        "sellerTaxNo": "",
        "itemName": "",
        "specModel": "",
        "unit": "",
        "quantity": "",
        "subtotalAmount": "",
        "taxAmount": "",
        "totalWithTax": "",
        "invoiceRemark": "",
    }


def parse_invoice_response(file_path):
    try:
        data = parse_invoice_file(str(file_path))
        data = merge_layout_result(data, parse_invoice_layout_file(file_path))
        return {
            "ok": True,
            "message": "OCR completed",
            "rawText": data.get("raw_text") or "",
            "invoiceNumber": data.get("invoice_number") or "",
            "invoiceType": data.get("invoice_type") or "",
            "issueDate": data.get("issue_date") or "",
            "buyerName": data.get("buyer_name") or "",
            "buyerTaxNo": data.get("buyer_tax_no") or "",
            "sellerName": data.get("seller_name") or "",
            "sellerTaxNo": data.get("seller_tax_no") or "",
            "itemName": data.get("item_name") or "",
            "specModel": data.get("spec_model") or "",
            "unit": data.get("unit") or "",
            "quantity": "" if data.get("quantity") is None else str(data.get("quantity")),
            "subtotalAmount": "" if data.get("amount_without_tax") is None else str(data.get("amount_without_tax")),
            "taxAmount": "" if data.get("tax_amount") is None else str(data.get("tax_amount")),
            "totalWithTax": "" if data.get("amount") is None else str(data.get("amount")),
            "invoiceRemark": data.get("description") or "",
        }
    except Exception as exc:
        return invoice_empty_result(str(exc) + "\n" + format_ocr_environment_status())


def income_empty_result(message):
    return {
        "ok": False,
        "message": message,
        "rawText": "",
        "amount": "",
        "transactionAccount": "",
        "transactionTime": "",
        "transactionLocation": "",
        "counterpartyAccount": "",
        "accountingDate": "",
    }


def normalize_text(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def compact_lines(text):
    return [line.strip() for line in text.splitlines() if line.strip()]


def clean_value(value):
    return re.sub(r"\s+", " ", value or "").strip(" :：")


def extract_after_label(lines, label, stop_labels):
    for index, line in enumerate(lines):
        if label not in line:
            continue
        value = line.split(label, 1)[1].strip(" :：")
        collected = [value] if value else []
        for next_line in lines[index + 1:]:
            if any(stop in next_line for stop in stop_labels):
                break
            if next_line:
                collected.append(next_line)
            if len(collected) >= 4:
                break
        return clean_value(" ".join(collected))
    return ""


def strip_balance_section(text):
    return re.split(r"账户余额|余额", text, maxsplit=1)[0]


def parse_amount(text):
    safe_text = strip_balance_section(text)
    matches = re.findall(r"(?:¥|￥|CNY|RMB)?\s*([+-]?\d[\d,]*\.\d{2})", safe_text)
    if not matches:
        return ""
    values = []
    for match in matches:
        try:
            values.append(abs(float(match.replace(",", ""))))
        except ValueError:
            pass
    return f"{max(values):.2f}" if values else ""


def first_match(value, pattern):
    match = re.search(pattern, value or "")
    return match.group(0) if match else value


def parse_income_response(file_path):
    try:
        text = recognize_invoice_file(str(file_path))
        normalized = normalize_text(text)
        lines = compact_lines(normalized)
        stop_labels = ["交易账户", "交易时间", "交易地点/附言", "对方账户", "记账日", "账户余额", "备注"]
        return {
            "ok": True,
        "message": "Income OCR completed",
        "rawText": strip_balance_section(normalized).strip(),
        "amount": parse_amount(normalized),
        "transactionAccount": extract_after_label(lines, "交易账户", stop_labels),
        "transactionTime": first_match(
            extract_after_label(lines, "交易时间", stop_labels),
            r"20\d{2}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?",
        ),
        "transactionLocation": extract_after_label(lines, "交易地点/附言", stop_labels),
        "counterpartyAccount": extract_after_label(lines, "对方账户", stop_labels),
        "accountingDate": first_match(
            extract_after_label(lines, "记账日", stop_labels),
            r"20\d{2}[-/]\d{1,2}[-/]\d{1,2}",
        ),
    }
    except Exception as exc:
        return income_empty_result(str(exc) + "\n" + format_ocr_environment_status())


def handle(request):
    action = request.get("action")
    if action == "invoice":
        return parse_invoice_response(Path(request["path"]))
    if action == "batch_invoice":
        return [parse_invoice_response(Path(item["path"])) for item in request.get("items", [])]
    if action == "income":
        return parse_income_response(Path(request["path"]))
    raise ValueError(f"Unknown OCR action: {action}")


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            result = handle(request)
            response = {"ok": True, "result": result}
        except Exception as exc:
            response = {"ok": False, "message": str(exc)}
        print(json.dumps(response, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
