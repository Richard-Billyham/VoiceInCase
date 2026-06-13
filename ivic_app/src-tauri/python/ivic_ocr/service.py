"""OCR and invoice text parsing helpers.

The OCR dependency is optional. If pytesseract/Pillow or the Tesseract
binary is not installed, callers will receive a clear RuntimeError.
"""

import re
from pathlib import Path
from shutil import which


COMMON_TESSERACT_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
]


def get_ocr_environment_status():
    """Return OCR/PDF dependency status for diagnostics."""
    status = {
        "pymupdf": _module_available("fitz"),
        "pytesseract": _module_available("pytesseract"),
        "pillow": _module_available("PIL"),
        "tesseract": _tesseract_executable_path(),
    }
    status["pdf_text_available"] = status["pymupdf"]
    status["image_ocr_available"] = bool(
        status["pytesseract"] and status["pillow"] and status["tesseract"]
    )
    return status


def format_ocr_environment_status():
    """Return a compact human-readable OCR environment diagnostic."""
    status = get_ocr_environment_status()
    missing = []
    if not status["pymupdf"]:
        missing.append("PyMuPDF（PDF 文本读取）")
    if not status["pytesseract"]:
        missing.append("pytesseract（OCR Python 调用）")
    if not status["pillow"]:
        missing.append("Pillow（图片读取）")
    if not status["tesseract"]:
        missing.append("Tesseract OCR 程序和中文语言包 chi_sim")

    if not missing:
        return "OCR 环境可用。"
    return "缺少：" + "；".join(missing)


def recognize_invoice_file(file_path):
    """Recognize text from an invoice image or PDF file."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"文件不存在：{file_path}")

    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return _recognize_pdf(path)
    if suffix in {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}:
        return _recognize_image(path)

    raise ValueError("暂不支持该文件类型，请选择 PDF 或图片文件")


def _module_available(module_name):
    try:
        __import__(module_name)
        return True
    except ImportError:
        return False


def _tesseract_executable_path():
    path = which("tesseract")
    if path:
        return path
    for path in COMMON_TESSERACT_PATHS:
        if Path(path).exists():
            return path
    return None


def parse_invoice_file(file_path, projects=None):
    """Recognize and parse an invoice file, using PDF layout when available."""
    path = Path(file_path)
    text = recognize_invoice_file(path)
    result = parse_invoice_text(text, projects=projects)

    if path.suffix.lower() == ".pdf":
        layout_item = _parse_pdf_layout_item(path)
        if layout_item:
            for key in ("item_name", "spec_model", "unit", "quantity"):
                if layout_item.get(key) not in (None, ""):
                    result[key] = layout_item[key]

    return result


def parse_invoice_text(text, projects=None):
    """Parse invoice fields and match project from OCR text."""
    normalized = _normalize_text(text)
    lines = _clean_lines(normalized)
    invoice_code, invoice_number = _parse_invoice_code_number(normalized, lines)
    amount_without_tax = _parse_amount_without_tax(normalized)
    tax_amount = _parse_tax_amount(normalized)
    total_amount = _parse_total_amount(normalized)
    tax_amount = _reconcile_tax_amount(amount_without_tax, tax_amount, total_amount)
    item = _parse_item(lines, amount_without_tax, tax_amount, total_amount)
    buyer = _parse_party_info(normalized, ["购买方", "买方", "购方"])
    seller = _parse_party_info(normalized, ["销售方", "卖方", "销方"])
    result = {
        "invoice_type": _parse_invoice_type(normalized),
        "invoice_code": invoice_code,
        "invoice_number": invoice_number,
        "issue_date": _parse_date(normalized),
        "buyer_name": buyer.get("name"),
        "buyer_tax_no": buyer.get("tax_no"),
        "seller_name": seller.get("name"),
        "seller_tax_no": seller.get("tax_no"),
        "item_name": item.get("item_name"),
        "spec_model": item.get("spec_model"),
        "unit": item.get("unit"),
        "quantity": item.get("quantity"),
        "amount_without_tax": amount_without_tax,
        "tax_amount": tax_amount,
        "amount": total_amount,
        "description": _parse_description(normalized),
        "project_id": _match_option(normalized, projects or [], "project_id", "project_name"),
        "raw_text": text.strip(),
    }
    return result


def _recognize_image(path):
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "缺少 OCR Python 依赖。请执行：pip install pytesseract Pillow"
        ) from exc

    _configure_tesseract(pytesseract)

    try:
        return pytesseract.image_to_string(Image.open(path), lang="chi_sim+eng")
    except pytesseract.pytesseract.TesseractNotFoundError as exc:
        raise RuntimeError(
            "未找到 Tesseract OCR 程序。请安装 Tesseract OCR，或把 tesseract.exe 加入 PATH。"
        ) from exc
    except Exception as exc:
        raise RuntimeError(
            "OCR 识别失败。请确认已安装 Tesseract OCR，并安装中文语言包 chi_sim。"
        ) from exc


def _recognize_pdf(path):
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("缺少 PDF 读取依赖。请执行：pip install PyMuPDF") from exc

    text_parts = []
    try:
        with fitz.open(path) as document:
            for page in document:
                page_text = page.get_text().strip()
                if page_text:
                    text_parts.append(page_text)
    except Exception as exc:
        raise RuntimeError(f"PDF 读取失败：{exc}") from exc

    text = "\n".join(text_parts).strip()
    if text:
        return text

    return _recognize_scanned_pdf(path)


def _extract_pdf_words(path):
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("缺少 PDF 读取依赖。请执行：pip install PyMuPDF") from exc

    pages = []
    try:
        with fitz.open(path) as document:
            for page_index, page in enumerate(document):
                words = []
                for word in page.get_text("words"):
                    words.append(
                        {
                            "page": page_index,
                            "x0": float(word[0]),
                            "y0": float(word[1]),
                            "x1": float(word[2]),
                            "y1": float(word[3]),
                            "text": str(word[4]).strip(),
                        }
                    )
                pages.append(words)
    except Exception:
        return []

    return pages


def _recognize_scanned_pdf(path):
    try:
        import fitz
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "扫描 PDF 需要 OCR 依赖。请执行：pip install PyMuPDF pytesseract Pillow"
        ) from exc

    _configure_tesseract(pytesseract)

    text_parts = []
    try:
        with fitz.open(path) as document:
            for page in document:
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
                page_text = pytesseract.image_to_string(image, lang="chi_sim+eng").strip()
                if page_text:
                    text_parts.append(page_text)
    except Exception as exc:
        raise RuntimeError(
            "扫描 PDF OCR 识别失败。请确认已安装 Tesseract OCR 和中文语言包 chi_sim。"
        ) from exc

    text = "\n".join(text_parts).strip()
    if not text:
        raise RuntimeError("未从 PDF 中识别到文字")
    return text


def _configure_tesseract(pytesseract):
    current = getattr(pytesseract.pytesseract, "tesseract_cmd", "tesseract")
    if current and Path(current).exists():
        return

    for path in COMMON_TESSERACT_PATHS:
        if Path(path).exists():
            pytesseract.pytesseract.tesseract_cmd = path
            return


def _normalize_text(text):
    text = text.replace("（", "(").replace("）", ")")
    text = text.replace("￥", "¥")
    text = text.replace("：", ":")
    text = re.sub(r"¥\s*[Bb](?=\d)", "¥6", text)
    text = re.sub(r"([0-9])\.\s+([0-9]{1,2})", r"\1.\2", text)
    text = re.sub(r"([0-9]),\s+([0-9]{1,2})", r"\1.\2", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text


def _first_match(text, patterns):
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def _clean_lines(text):
    return [line.strip() for line in text.splitlines() if line.strip()]


def _parse_invoice_code_number(text, lines):
    compact_number = _parse_compact_invoice_number(text)
    if compact_number:
        return None, compact_number

    invoice_code = _first_match(
        text,
        [
            r"发票代码[: ]*([0-9A-Za-z]{6,20})",
            r"代码[: ]*([0-9A-Za-z]{6,20})",
        ],
    )
    invoice_number = _first_match(
        text,
        [
            r"发票号码[: ]*([0-9A-Za-z]{6,20})",
            r"号码[: ]*([0-9A-Za-z]{6,20})",
        ],
    )
    if invoice_code or invoice_number:
        return invoice_code, invoice_number

    date_index = _find_first_index(lines, lambda line: re.search(r"\d{4}年\d{1,2}月\d{1,2}日", line))
    numeric_lines = [
        (index, line)
        for index, line in enumerate(lines)
        if re.fullmatch(r"\d{8,20}", line)
    ]

    if "增值税" in text and date_index is not None:
        before_date = [(index, line) for index, line in numeric_lines if index < date_index]
        if len(before_date) >= 2:
            return before_date[0][1], before_date[1][1]

    long_numbers = [line for _, line in numeric_lines if len(line) >= 20]
    if long_numbers:
        return None, long_numbers[0]

    eight_numbers = [line for _, line in numeric_lines if len(line) == 8]
    if eight_numbers:
        return None, eight_numbers[0]

    return None, None


def _parse_compact_invoice_number(text):
    match = re.search(r"(?<!\d)(\d{20})(?!\d)", text)
    if match:
        return match.group(1)

    match = re.search(r"(?<!\d)(\d{10,12})\s+(\d{8,10})(?!\d)", text)
    if match:
        candidate = "".join(match.groups())
        if len(candidate) == 20:
            return candidate

    return None


def _parse_date(text):
    labeled_date = _parse_labeled_issue_date(text)
    if labeled_date:
        return labeled_date

    parsed_date = _first_date_in_text(text)
    if parsed_date:
        return parsed_date
    return None


def _parse_labeled_issue_date(text):
    issue_date_labels = [
        r"开\s*票\s*日\s*期",
        r"开\s*具\s*日\s*期",
        r"开\s*票\s*时\s*间",
        r"开\s*具\s*时\s*间",
    ]
    for label_pattern in issue_date_labels:
        for match in re.finditer(label_pattern, text, flags=re.IGNORECASE):
            # Railway e-tickets include a travel date before the invoice date.
            # Prefer the date near the explicit issue-date label.
            window = text[match.end() : match.end() + 80]
            parsed_date = _first_date_in_text(window)
            if parsed_date:
                return parsed_date
    return None


def _first_date_in_text(text):
    patterns = [
        r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?",
        r"(20\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})",
        r"\b(20\d{2})(\d{2})(\d{2})\b",
        r"(20\d{2})\D{0,4}(\d{2})\D{0,4}(\d{1,2})",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            parsed_date = _format_date_or_none(*match.groups())
            if parsed_date:
                return parsed_date
    return None


def _format_date_or_none(year, month, day):
    try:
        year = int(year)
        month = int(month)
        day = int(day)
    except ValueError:
        return None

    if year < 2000 or year > 2099:
        return None
    if month < 1 or month > 12:
        return None
    if day < 1 or day > 31:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def _parse_invoice_type(text):
    for keyword in ["增值税专用发票", "专用发票", "增值税普通发票", "普通发票", "电子发票"]:
        if keyword in text:
            return keyword
    return None


def _parse_party_info(text, labels):
    section = _party_section(text, labels)
    return {
        "name": _parse_party_name(section, labels),
        "tax_no": _parse_party_tax_no(section),
    }


def _party_section(text, labels):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    party_markers = ["购买方", "买方", "购方", "销售方", "卖方", "销方"]
    for index, line in enumerate(lines):
        if any(label in line for label in labels):
            section_lines = [line]
            for next_line in lines[index + 1 : index + 10]:
                if any(marker in next_line for marker in party_markers):
                    break
                section_lines.append(next_line)
            return "\n".join(section_lines)
    return text


def _parse_party_name(text, labels):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        if any(label in line for label in labels) or index == 0:
            candidates = [
                r"名称[: ]*([^\n:：]+)",
                r"名\s*称[: ]*([^\n:：]+)",
            ]
            for pattern in candidates:
                match = re.search(pattern, line)
                if match:
                    return _clean_party_name(match.group(1))
            for next_line in lines[index + 1 : index + 5]:
                match = re.search(r"名称[: ]*([^\n:：]+)", next_line)
                if match:
                    return _clean_party_name(match.group(1))
    return None


def _parse_party_tax_no(text):
    patterns = [
        r"(?:纳税人识别号|统一社会信用代码|信用代码|税号)[: ]*([0-9A-Z\s]{8,40})",
        r"(?:纳税人|识别号)[: ]*([0-9A-Z\s]{8,40})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return _clean_tax_no(match.group(1))
    return None


def _clean_party_name(value):
    value = re.split(r"(纳税人|统一社会|税号|地址|电话|开户行|账号)", value)[0]
    return value.strip(" :：")


def _clean_tax_no(value):
    cleaned = re.sub(r"[^0-9A-Z]", "", str(value or "").upper())
    return cleaned or None


def _parse_total_amount(text):
    labels = [
        r"价税合计(?:\(小写\)|小写)?[: ]*\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)",
        r"小写[: ]*\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)",
        r"合计[: ]*\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)",
    ]
    value = _first_match(text, labels)
    if value:
        return _to_float(value)

    currency_values = _currency_values(text)
    return currency_values[-1] if currency_values else None


def _parse_amount_without_tax(text):
    value = _first_match(
        text,
        [
            r"金额[: ]*\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:税率|税额)",
            r"合\s*计[: ]*\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*[¥￥]?[0-9,]+(?:\.[0-9]{1,2})?",
        ],
    )
    if value:
        return _to_float(value)

    currency_values = _currency_values(text)
    return currency_values[0] if len(currency_values) >= 2 else None


def _parse_tax_amount(text):
    value = _first_match(
        text,
        [
            r"税额[:：]?\s*[¥￥]?\s*([0-9]+(?:\.[0-9]{1,2})?)",
            r"税\s*额[:：]?\s*[¥￥]?\s*([0-9]+(?:\.[0-9]{1,2})?)",
            r"税额[: ]*\s*[¥￥]?\s*([0-9,]+(?:\.[0-9]{1,2})?)",
        ],
    )
    if value:
        return _to_float(value)

    currency_values = _currency_values(text)
    if len(currency_values) >= 3:
        return currency_values[-2]
    return None


def _reconcile_tax_amount(amount_without_tax, tax_amount, total_amount):
    if amount_without_tax is None or total_amount is None:
        return tax_amount

    calculated_tax = round(total_amount - amount_without_tax, 2)
    if calculated_tax < 0:
        return tax_amount
    if tax_amount is None:
        return calculated_tax
    if abs(calculated_tax - tax_amount) > 0.02:
        return calculated_tax
    return tax_amount


def _match_option(text, rows, id_key, label_key):
    for row in rows:
        label = str(row.get(label_key) or "").strip()
        if label and label in text:
            return row.get(id_key)
    return None


def _to_float(value):
    if value is None:
        return None
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


def _parse_item(lines, amount_without_tax=None, tax_amount=None, total_amount=None):
    railway_item = _parse_railway_ticket_item(lines)
    if railway_item:
        return railway_item

    star_indices = [index for index, line in enumerate(lines) if line.startswith("*")]
    if not star_indices:
        return _empty_item()

    start = star_indices[0]
    star_line = lines[start]
    category, first_name_part = _split_tax_category(star_line)
    after_star = lines[start + 1 : start + 12]

    standard_item = _parse_standard_e_invoice_item(
        category,
        first_name_part,
        after_star,
        amount_without_tax,
        tax_amount,
        total_amount,
    )
    if standard_item:
        return standard_item

    unit_index = _find_first_index(after_star, _is_unit)
    if unit_index is None:
        return {
            "item_name": _build_tax_item_name(category, first_name_part),
            "spec_model": None,
            "unit": None,
            "quantity": None,
        }

    line_before_unit = after_star[unit_index - 1] if unit_index > 0 else None
    unit = after_star[unit_index]
    quantity = _find_quantity(after_star, unit_index, amount_without_tax, tax_amount, total_amount)

    if unit_index == 0:
        tail_parts = []
        for line in after_star[1:]:
            if line.startswith("*") or line.startswith("¥") or "共" in line or "订单号" in line:
                break
            if _is_unit(line) or _is_number(line) or _is_tax_rate(line):
                continue
            tail_parts.append(line)
        product_name = _clean_product_name([first_name_part] + tail_parts)
        item_name = _build_tax_item_name(category, product_name)
        spec_model = product_name
    else:
        item_name = _build_tax_item_name(category, first_name_part)
        spec_model = (
            line_before_unit
            if _is_valid_spec_model(line_before_unit, amount_without_tax, tax_amount, total_amount)
            else None
        )

    return {
        "item_name": item_name or None,
        "spec_model": spec_model,
        "unit": unit,
        "quantity": _to_float(quantity),
    }


def _parse_pdf_layout_item(path):
    for words in _extract_pdf_words(path):
        item = _parse_pdf_page_layout_item(words)
        if item:
            return item
    return None


def _parse_pdf_page_layout_item(words):
    words = [word for word in words if word["text"]]
    item_header = _find_word(words, lambda text: text == "项目名称")
    spec_header = _find_word(words, lambda text: text == "规格型号")
    if not item_header or not spec_header:
        return None

    header_y = (item_header["y0"] + item_header["y1"]) / 2
    header_words = [word for word in words if abs(_word_center_y(word) - header_y) <= 8]
    tax_header = _find_word(header_words, lambda text: "税率" in text)

    item_x = _word_center_x(item_header)
    spec_x = _word_center_x(spec_header)
    unit_x = _first_header_x(header_words, "单", spec_x, None)
    quantity_x = _first_header_x(header_words, "数", unit_x or spec_x, None)
    tax_x = _word_center_x(tax_header) if tax_header else max(_word_center_x(word) for word in words)

    if unit_x is None:
        unit_x = spec_x + 80
    if quantity_x is None:
        quantity_x = unit_x + 85

    columns = _layout_columns(
        {
            "item_name": item_x,
            "spec_model": spec_x,
            "unit": unit_x,
            "quantity": quantity_x,
            "tax_rate": tax_x,
        }
    )
    bottom_y = _find_detail_bottom_y(words, header_y)
    detail_words = [
        word
        for word in words
        if word["y0"] > header_y + 2 and word["y0"] < bottom_y
    ]
    if not detail_words:
        return None

    first_start = _find_first_detail_start(detail_words, columns["item_name"])
    if first_start is None:
        return None

    next_start_y = _find_next_detail_start_y(detail_words, columns["item_name"], first_start["y0"])
    first_words = [
        word
        for word in detail_words
        if word["y0"] >= first_start["y0"] - 2
        and (next_start_y is None or word["y0"] < next_start_y - 2)
    ]

    item_name = _join_layout_column(first_words, columns["item_name"])
    spec_model = _join_layout_column(first_words, columns["spec_model"])
    unit = _first_layout_value(first_words, columns["unit"], _is_unit)
    quantity = _first_layout_value(first_words, columns["quantity"], _is_number)

    if not item_name:
        return None

    return {
        "item_name": _clean_text_fragment(item_name),
        "spec_model": _clean_text_fragment(spec_model) or None,
        "unit": unit,
        "quantity": _to_float(quantity),
    }


def _find_word(words, predicate):
    for word in words:
        if predicate(word["text"]):
            return word
    return None


def _first_header_x(words, text, min_x, max_x):
    candidates = [
        _word_center_x(word)
        for word in words
        if word["text"] == text
        and _word_center_x(word) > min_x
        and (max_x is None or _word_center_x(word) < max_x)
    ]
    return min(candidates) if candidates else None


def _layout_columns(centers):
    ordered = sorted(centers.items(), key=lambda item: item[1])
    columns = {}
    for index, (name, center) in enumerate(ordered):
        left = -float("inf") if index == 0 else (ordered[index - 1][1] + center) / 2
        right = float("inf") if index == len(ordered) - 1 else (center + ordered[index + 1][1]) / 2
        columns[name] = (left, right)
    return columns


def _find_detail_bottom_y(words, header_y):
    candidates = [
        word["y0"]
        for word in words
        if word["y0"] > header_y + 20
        and word["x0"] < 160
        and word["text"] in {"合", "计", "合计"}
    ]
    return min(candidates) if candidates else header_y + 260


def _find_first_detail_start(words, item_column):
    item_words = [
        word
        for word in words
        if _word_in_column(word, item_column) and word["text"].startswith("*")
    ]
    if item_words:
        return min(item_words, key=lambda word: word["y0"])
    return min(words, key=lambda word: word["y0"]) if words else None


def _find_next_detail_start_y(words, item_column, start_y):
    candidates = [
        word["y0"]
        for word in words
        if word["y0"] > start_y + 4
        and _word_in_column(word, item_column)
        and word["text"].startswith("*")
    ]
    return min(candidates) if candidates else None


def _join_layout_column(words, column):
    column_words = [
        word
        for word in words
        if _word_in_column(word, column)
        and not _is_layout_noise(word["text"])
    ]
    column_words.sort(key=lambda word: (round(word["y0"], 1), word["x0"]))
    return "".join(word["text"] for word in column_words)


def _first_layout_value(words, column, predicate):
    column_words = [
        word
        for word in words
        if _word_in_column(word, column)
        and predicate(word["text"])
    ]
    column_words.sort(key=lambda word: (word["y0"], word["x0"]))
    return column_words[0]["text"] if column_words else None


def _word_in_column(word, column):
    center_x = _word_center_x(word)
    return column[0] <= center_x < column[1]


def _word_center_x(word):
    return (word["x0"] + word["x1"]) / 2


def _word_center_y(word):
    return (word["y0"] + word["y1"]) / 2


def _is_layout_noise(text):
    return text in {"", " "} or text.startswith("下载次数")


def _parse_railway_ticket_item(lines):
    text = "\n".join(lines)
    if "铁路电子客票" not in text:
        return None

    seat_type = _first_railway_seat_type(text)
    return {
        "item_name": "*运输服务*铁路电子客票",
        "spec_model": seat_type,
        "unit": "张",
        "quantity": 1.0,
    }


def _first_railway_seat_type(text):
    seat_types = [
        "商务座",
        "特等座",
        "一等座",
        "二等座",
        "软卧",
        "硬卧",
        "软座",
        "硬座",
        "无座",
    ]
    for seat_type in seat_types:
        if seat_type in text:
            return seat_type
    return None


def _parse_standard_e_invoice_item(
    category,
    first_name_part,
    after_star,
    amount_without_tax=None,
    tax_amount=None,
    total_amount=None,
):
    tax_index = _find_first_index(after_star, _is_tax_rate)
    if tax_index is None:
        return None

    unit_index = _find_first_index(after_star, _is_unit)
    if unit_index is not None and unit_index < tax_index:
        return None

    before_tax = after_star[:tax_index]
    after_tax = after_star[tax_index + 1 :]

    product_parts = [first_name_part]
    spec_model = None
    if before_tax:
        possible_spec = before_tax[-1]
        if _looks_like_spec_model(possible_spec):
            spec_model = possible_spec
            product_parts.extend(before_tax[:-1])
        else:
            product_parts.extend(before_tax)

    product_name = _clean_product_name(product_parts)
    unit = _find_first_value(after_tax, _is_unit)
    quantity = _find_quantity_after_tax(after_tax, amount_without_tax, tax_amount, total_amount)

    return {
        "item_name": _build_tax_item_name(category, product_name),
        "spec_model": spec_model,
        "unit": unit,
        "quantity": _to_float(quantity),
    }


def _empty_item():
    return {
        "item_name": None,
        "spec_model": None,
        "unit": None,
        "quantity": None,
    }


def _split_tax_category(line):
    match = re.match(r"^\*([^*]+)\*(.+)$", line.strip())
    if not match:
        return None, line.strip()
    return match.group(1).strip(), match.group(2).strip()


def _build_tax_item_name(category, product_name):
    product_name = _clean_text_fragment(product_name)
    if category:
        return f"*{category}*{product_name}" if product_name else f"*{category}*"
    return product_name


def _is_unit(line):
    return line in {"个", "套", "台", "件", "条", "批", "份", "本", "张", "米", "千克", "公斤", "项"}


def _is_number(line):
    return re.fullmatch(r"-?\d+(?:\.\d+)?", line) is not None


def _is_tax_rate(line):
    return re.fullmatch(r"\d+(?:\.\d+)?%", line) is not None


def _looks_like_spec_model(line):
    if not line:
        return False
    if _is_tax_rate(line) or _is_unit(line):
        return False
    if re.fullmatch(r"\d{4,}", line):
        return True
    if _is_number(line):
        return False
    if re.search(r"[A-Za-z0-9]", line) and not re.search(r"[\u4e00-\u9fff]", line):
        return True
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9\-_/]+", line):
        return True
    return False


def _is_currency(line):
    return re.fullmatch(r"[¥￥]\s*\d+(?:\.\d+)?", line) is not None


def _is_amount_value(value, *amounts):
    number = _to_float(value)
    if number is None:
        return False
    return any(amount is not None and abs(number - amount) < 0.001 for amount in amounts)


def _is_valid_spec_model(value, amount_without_tax=None, tax_amount=None, total_amount=None):
    if not value:
        return False
    if _is_number(value) or _is_tax_rate(value) or _is_currency(value):
        return False
    if _is_amount_value(value, amount_without_tax, tax_amount, total_amount):
        return False
    return value not in {"合计", "价税合计", "小写", "备注"}


def _find_quantity(lines_after_star, unit_index, amount_without_tax=None, tax_amount=None, total_amount=None):
    search_ranges = [
        lines_after_star[unit_index + 1 : unit_index + 8],
        lines_after_star[max(0, unit_index - 4) : unit_index],
    ]
    for candidates in search_ranges:
        for line in candidates:
            if not _is_number(line):
                continue
            if _is_amount_value(line, amount_without_tax, tax_amount, total_amount):
                continue
            value = _to_float(line)
            if value is not None and value > 0:
                return line
    return None


def _find_quantity_after_tax(after_tax, amount_without_tax=None, tax_amount=None, total_amount=None):
    numeric_values = [
        line
        for line in after_tax
        if _is_number(line)
        and not _is_amount_value(line, amount_without_tax, tax_amount, total_amount)
    ]
    if not numeric_values:
        return None
    return numeric_values[-1]


def _find_first_index(items, predicate):
    for index, item in enumerate(items):
        if predicate(item):
            return index
    return None


def _find_first_value(items, predicate):
    for item in items:
        if predicate(item):
            return item
    return None


def _guess_spec_model(item_name):
    if not item_name:
        return None
    model_match = re.search(r"([A-Za-z0-9]+[A-Za-z0-9\-_/]*\d+[A-Za-z0-9\-_/]*)", item_name)
    return model_match.group(1) if model_match else None


def _clean_product_name(parts):
    tokens = []
    for part in parts:
        tokens.extend(str(part or "").split())

    if not tokens:
        return None

    tokens = _remove_redundant_tokens(tokens)
    merged = "".join(tokens) if _looks_like_split_chinese_product(tokens) else " ".join(tokens)

    merged = _remove_overlap_duplication(merged)
    return _clean_text_fragment(merged)


def _remove_redundant_tokens(tokens):
    kept = []
    for token in tokens:
        if any(token == existing or (len(token) > 1 and token in existing) for existing in kept):
            continue
        kept = [
            existing
            for existing in kept
            if not (len(existing) > 1 and existing in token)
        ]
        kept.append(token)
    return kept


def _looks_like_split_chinese_product(tokens):
    if len(tokens) <= 1:
        return False
    return any(re.search(r"[\u4e00-\u9fff]", token) for token in tokens)


def _remove_overlap_duplication(value):
    value = value.strip()
    changed = True
    while changed:
        changed = False
        for start in range(1, len(value)):
            for length in range(min(16, len(value) - start), 1, -1):
                left_start = max(0, start - length)
                left = value[left_start:start]
                right = value[start : start + length]
                if left and left == right:
                    value = value[:start] + value[start + length :]
                    changed = True
                    break
            if changed:
                break
    return value


def _clean_text_fragment(value):
    return re.sub(r"\s+", "", str(value or "")).strip()


def _currency_values(text):
    values = re.findall(r"[¥￥]\s*([0-9,]+(?:\.[0-9]{1,2})?)", text)
    return [_to_float(value) for value in values]


def _parse_description(text):
    order_no = _first_match(text, [r"订单号[: ]*([A-Za-z0-9_-]+)"])
    invoice_type = _parse_invoice_type(text)
    parts = []
    if invoice_type:
        parts.append(invoice_type)
    if order_no:
        parts.append(f"订单号:{order_no}")
    return "；".join(parts) if parts else None
