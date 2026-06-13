"""Layout-assisted invoice parsing for IVIC.

This module lives in the new Tauri app so the legacy invoice_manager OCR code
can stay untouched. It uses embedded PDF text coordinates first, then falls
back to conservative regex extraction.
"""

from __future__ import annotations

import re
from pathlib import Path


TAX_NO_PATTERN = re.compile(r"^[0-9A-Z]{15,24}$")
CURRENCY_PATTERN = re.compile(r"^[¥￥]\s*([0-9,]+(?:\.\d{1,2})?)$")


def parse_invoice_layout_file(file_path):
    path = Path(file_path)
    if path.suffix.lower() != ".pdf":
        return {}

    try:
        import fitz
    except ImportError:
        return {}

    result = {}
    try:
        with fitz.open(path) as document:
            for page in document:
                words = _extract_words(page)
                if not words:
                    continue
                _merge_missing(result, _parse_header(words))
                _merge_missing(result, _parse_party_layout(words, float(page.rect.width)))
                _merge_missing(result, _parse_item_layout(words))
                _merge_missing(result, _parse_amount_layout(words))
                _merge_missing(result, _parse_remark_layout(words, float(page.rect.height)))
                if _has_party_fields(result):
                    break
    except Exception:
        return result

    return {key: value for key, value in result.items() if value not in (None, "")}


def _extract_words(page):
    words = []
    for item in page.get_text("words"):
        text = str(item[4]).strip()
        if not text:
            continue
        words.append(
            {
                "x0": float(item[0]),
                "y0": float(item[1]),
                "x1": float(item[2]),
                "y1": float(item[3]),
                "text": text,
            }
        )
    words.sort(key=lambda word: (round(word["y0"], 1), word["x0"]))
    return words


def _parse_header(words):
    text = _linear_text(words)
    invoice_number = _first_match(
        text,
        [
            r"发票号码[:：\s]*([0-9A-Z]{8,24})",
            r"号码[:：\s]*([0-9A-Z]{8,24})",
        ],
    )
    issue_date = _first_match(
        text,
        [
            r"开票日期[:：\s]*(20\d{2})年(\d{1,2})月(\d{1,2})日",
            r"开具日期[:：\s]*(20\d{2})年(\d{1,2})月(\d{1,2})日",
        ],
    )
    result = {}
    if invoice_number:
        result["invoice_number"] = invoice_number
    if isinstance(issue_date, tuple):
        result["issue_date"] = f"{int(issue_date[0]):04d}-{int(issue_date[1]):02d}-{int(issue_date[2]):02d}"
    return result


def _parse_party_layout(words, page_width):
    result = {}
    tax_labels = [word for word in words if _is_tax_label(word["text"])]

    for label in tax_labels:
        side = _party_side(label, page_width)
        if side is None:
            continue
        tax_no = _value_right_of_label(words, label, page_width, _clean_tax_no)
        name = _name_near_tax_label(words, label, page_width)
        if tax_no:
            result[f"{side}_tax_no"] = tax_no
        if name:
            result[f"{side}_name"] = name

    _merge_missing(result, _parse_party_fallback(words, page_width))
    return result


def _parse_party_fallback(words, page_width):
    result = {}
    name_words = [word for word in words if "名称" in word["text"]]
    for name_word in name_words:
        side = _party_side(name_word, page_width)
        if side is None:
            continue
        name = _clean_party_name(_label_inline_value(name_word["text"], "名称"))
        if name:
            result[f"{side}_name"] = name
        tax_no = _nearest_tax_no(words, name_word, page_width)
        if tax_no:
            result[f"{side}_tax_no"] = tax_no
    return result


def _parse_amount_layout(words):
    result = {}
    currency_words = [word for word in words if CURRENCY_PATTERN.match(word["text"])]
    for word in currency_words:
        value = _currency_value(word["text"])
        if value is None:
            continue
        line_text = _row_text(words, word)
        if "价税合计" in line_text or "小写" in line_text:
            result["amount"] = value
            continue
        if "合" in line_text and "计" in line_text:
            row_values = [
                (_center_x(candidate), _currency_value(candidate["text"]))
                for candidate in currency_words
                if abs(_center_y(candidate) - _center_y(word)) <= 4
            ]
            row_values = [(x, amount) for x, amount in row_values if amount is not None]
            row_values.sort(key=lambda item: item[0])
            if row_values:
                result["amount_without_tax"] = row_values[0][1]
            if len(row_values) >= 2:
                result["tax_amount"] = row_values[-1][1]
    return result


def _parse_item_layout(words):
    item_header = _find_word(words, lambda text: text == "项目名称")
    spec_header = _find_word(words, lambda text: text == "规格型号")
    if not item_header or not spec_header:
        return {}

    header_y = _center_y(item_header)
    header_words = [word for word in words if abs(_center_y(word) - header_y) <= 8]
    item_x = _center_x(item_header)
    spec_x = _center_x(spec_header)
    unit_x = _header_pair_center(header_words, "单", "位", spec_x)
    quantity_x = _header_pair_center(header_words, "数", "量", unit_x or spec_x)

    if unit_x is None:
        return {}
    if quantity_x is None:
        quantity_x = unit_x + 80

    columns = _layout_columns(
        {
            "item_name": item_x,
            "spec_model": spec_x,
            "unit": unit_x,
            "quantity": quantity_x,
        }
    )
    bottom_y = _first_total_row_y(words, header_y)
    detail_words = [
        word
        for word in words
        if word["y0"] > header_y + 2 and word["y0"] < bottom_y
    ]
    if not detail_words:
        return {}

    first_start = _first_item_start(detail_words, columns["item_name"])
    if not first_start:
        return {}
    next_start_y = _next_item_start_y(detail_words, columns["item_name"], first_start["y0"])
    first_words = [
        word
        for word in detail_words
        if word["y0"] >= first_start["y0"] - 2
        and (next_start_y is None or word["y0"] < next_start_y - 2)
    ]
    if not first_words:
        return {}

    spec_model = _join_column_words(first_words, columns["spec_model"])
    if _looks_like_spec_model_noise(spec_model):
        spec_model = None

    result = {
        "item_name": _join_column_words(first_words, columns["item_name"]),
        "spec_model": spec_model,
        "unit": _first_column_word(first_words, columns["unit"], _looks_like_unit),
        "quantity": _to_float(_first_column_word(first_words, columns["quantity"], _looks_like_number)),
    }
    return {key: value for key, value in result.items() if value not in (None, "")}


def _parse_remark_layout(words, page_height):
    remark_labels = [word for word in words if word["text"] in {"备", "注", "备注"}]
    if not remark_labels:
        return {}
    min_y = min(word["y0"] for word in remark_labels) - 18
    max_y = min(page_height, max(word["y1"] for word in remark_labels) + 22)
    remark_words = [
        word
        for word in words
        if word["y0"] >= min_y
        and word["y1"] <= max_y
        and word["x0"] > 26
        and not _is_party_or_label_noise(word["text"])
    ]
    remark = _join_words_by_rows(remark_words)
    return {"description": remark} if remark else {}


def _value_right_of_label(words, label, page_width, cleaner):
    right_bound = page_width / 2 if _center_x(label) < page_width / 2 else page_width
    candidates = [
        word
        for word in words
        if word is not label
        and word["x0"] >= label["x1"] - 10
        and word["x0"] < right_bound
        and abs(_center_y(word) - _center_y(label)) <= 8
        and not _is_value_noise(word["text"])
    ]
    candidates.sort(key=lambda word: word["x0"])
    for candidate in candidates:
        value = cleaner(candidate["text"])
        if value:
            return value
    return None


def _name_near_tax_label(words, tax_label, page_width):
    left_bound = 0 if _center_x(tax_label) < page_width / 2 else page_width / 2
    right_bound = page_width / 2 if _center_x(tax_label) < page_width / 2 else page_width
    candidates = [
        word
        for word in words
        if left_bound <= _center_x(word) < right_bound
        and "名称" in word["text"]
        and tax_label["y0"] - 48 <= word["y0"] <= tax_label["y0"] + 8
    ]
    candidates.sort(key=lambda word: (abs(word["y0"] - tax_label["y0"]), word["x0"]))
    for candidate in candidates:
        value = _clean_party_name(_label_inline_value(candidate["text"], "名称"))
        if value:
            return value
        value = _value_right_of_label(words, candidate, right_bound, _clean_party_name)
        if value:
            return value
    return None


def _nearest_tax_no(words, name_word, page_width):
    side = _party_side(name_word, page_width)
    if side is None:
        return None
    left_bound = 0 if side == "buyer" else page_width / 2
    right_bound = page_width / 2 if side == "buyer" else page_width
    candidates = [
        word
        for word in words
        if left_bound <= _center_x(word) < right_bound
        and 0 <= word["y0"] - name_word["y0"] <= 48
    ]
    candidates.sort(key=lambda word: (abs(word["y0"] - name_word["y0"]), word["x0"]))
    for candidate in candidates:
        tax_no = _clean_tax_no(candidate["text"])
        if tax_no:
            return tax_no
    return None


def _find_word(words, predicate):
    for word in words:
        if predicate(word["text"]):
            return word
    return None


def _header_pair_center(words, left_text, right_text, min_x):
    ordered = sorted(words, key=lambda word: word["x0"])
    for index, word in enumerate(ordered):
        if word["text"] != left_text or _center_x(word) <= min_x:
            continue
        for next_word in ordered[index + 1 : index + 4]:
            if next_word["text"] == right_text and 0 < next_word["x0"] - word["x1"] < 36:
                return (_center_x(word) + _center_x(next_word)) / 2
    compact = left_text + right_text
    for word in ordered:
        if word["text"].replace(" ", "") == compact and _center_x(word) > min_x:
            return _center_x(word)
    return None


def _layout_columns(centers):
    ordered = sorted(centers.items(), key=lambda item: item[1])
    columns = {}
    for index, (name, center) in enumerate(ordered):
        left = -float("inf") if index == 0 else (ordered[index - 1][1] + center) / 2
        right = float("inf") if index == len(ordered) - 1 else (center + ordered[index + 1][1]) / 2
        columns[name] = (left, right)
    return columns


def _first_total_row_y(words, header_y):
    candidates = [
        word["y0"]
        for word in words
        if word["y0"] > header_y + 20
        and word["x0"] < 150
        and word["text"] in {"合", "计", "合计"}
    ]
    return min(candidates) if candidates else header_y + 180


def _first_item_start(words, item_column):
    candidates = [
        word
        for word in words
        if _word_in_column(word, item_column) and word["text"].startswith("*")
    ]
    if candidates:
        return min(candidates, key=lambda word: word["y0"])
    return min(words, key=lambda word: word["y0"]) if words else None


def _next_item_start_y(words, item_column, start_y):
    candidates = [
        word["y0"]
        for word in words
        if word["y0"] > start_y + 4
        and _word_in_column(word, item_column)
        and word["text"].startswith("*")
    ]
    return min(candidates) if candidates else None


def _join_column_words(words, column):
    column_words = [
        word
        for word in words
        if _word_in_column(word, column)
        and not _is_value_noise(word["text"])
        and not _looks_like_tax_rate(word["text"])
    ]
    column_words.sort(key=lambda word: (round(word["y0"], 1), word["x0"]))
    value = "".join(word["text"] for word in column_words).strip()
    return value or None


def _first_column_word(words, column, predicate):
    candidates = [
        word["text"]
        for word in sorted(words, key=lambda item: (item["y0"], item["x0"]))
        if _word_in_column(word, column) and predicate(word["text"])
    ]
    return candidates[0] if candidates else None


def _word_in_column(word, column):
    center_x = _center_x(word)
    return column[0] <= center_x < column[1]


def _party_side(word, page_width):
    center = _center_x(word)
    if center < page_width * 0.48:
        return "buyer"
    if center > page_width * 0.52:
        return "seller"
    return None


def _is_tax_label(text):
    compact = re.sub(r"\s+", "", text)
    return "纳税人识别号" in compact or "统一社会信用代码" in compact or compact == "税号"


def _clean_tax_no(value):
    cleaned = re.sub(r"[^0-9A-Z]", "", str(value or "").upper())
    if TAX_NO_PATTERN.fullmatch(cleaned):
        return cleaned
    return None


def _clean_party_name(value):
    value = str(value or "").strip()
    if _is_value_noise(value):
        return None
    value = re.split(r"(统一社会|纳税人|税号|地址|电话|开户行|账号)", value)[0]
    value = value.strip(" :：")
    return value or None


def _label_inline_value(text, label):
    pattern = rf"{label}\s*[:：]?\s*(.+)"
    match = re.search(pattern, str(text or ""))
    return match.group(1).strip() if match else ""


def _currency_value(text):
    match = CURRENCY_PATTERN.match(str(text or "").strip())
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except ValueError:
        return None


def _to_float(value):
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


def _looks_like_unit(text):
    compact = re.sub(r"\s+", "", str(text or ""))
    if not compact:
        return False
    if compact in {
        "个",
        "套",
        "台",
        "件",
        "条",
        "批",
        "份",
        "本",
        "张",
        "米",
        "千克",
        "公斤",
        "项",
        "卷",
        "片",
        "瓶",
        "盒",
        "包",
        "次",
        "PCS",
        "EA",
    }:
        return True
    return re.fullmatch(r"[A-Za-z]{1,5}", compact) is not None


def _looks_like_spec_model_noise(text):
    compact = re.sub(r"\s+", "", str(text or ""))
    if not compact:
        return False
    return compact in {"规格型号", "规格", "型号", "单位", "单价", "数量"} or _looks_like_unit(compact)


def _looks_like_number(text):
    return re.fullmatch(r"-?\d+(?:\.\d+)?", str(text or "").strip()) is not None


def _looks_like_tax_rate(text):
    return re.fullmatch(r"\d+(?:\.\d+)?%", str(text or "").strip()) is not None


def _row_text(words, anchor):
    row_words = [word for word in words if abs(_center_y(word) - _center_y(anchor)) <= 5]
    row_words.sort(key=lambda word: word["x0"])
    return "".join(word["text"] for word in row_words)


def _join_words_by_rows(words):
    if not words:
        return ""
    rows = []
    for word in sorted(words, key=lambda item: (item["y0"], item["x0"])):
        for row in rows:
            if abs(row["y"] - _center_y(word)) <= 5:
                row["words"].append(word)
                break
        else:
            rows.append({"y": _center_y(word), "words": [word]})
    lines = []
    for row in rows:
        row["words"].sort(key=lambda item: item["x0"])
        lines.append(" ".join(word["text"] for word in row["words"]).strip())
    return "\n".join(line for line in lines if line).strip()


def _is_party_or_label_noise(text):
    compact = re.sub(r"\s+", "", str(text or ""))
    if compact in {"购", "买", "方", "销", "售", "信", "息", "备", "注"}:
        return True
    if _is_value_noise(compact):
        return True
    return "名称" in compact or "纳税人识别号" in compact or "统一社会信用代码" in compact


def _is_value_noise(text):
    compact = re.sub(r"\s+", "", str(text or ""))
    if not compact:
        return True
    return any(
        marker in compact
        for marker in (
            "下载次数",
            "开票人",
            "收款人",
            "复核人",
            "项目名称",
            "规格型号",
            "税率",
            "税额",
            "合计",
        )
    )


def _linear_text(words):
    return "\n".join(word["text"] for word in words)


def _first_match(text, patterns):
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue
        if len(match.groups()) == 1:
            return match.group(1).strip()
        return match.groups()
    return None


def _merge_missing(target, source):
    for key, value in (source or {}).items():
        if value not in (None, "") and target.get(key) in (None, ""):
            target[key] = value


def _has_party_fields(result):
    return all(
        result.get(key)
        for key in ("buyer_name", "buyer_tax_no", "seller_name", "seller_tax_no")
    )


def _center_x(word):
    return (word["x0"] + word["x1"]) / 2


def _center_y(word):
    return (word["y0"] + word["y1"]) / 2
