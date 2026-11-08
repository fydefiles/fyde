"""Bounded customer-data parser subprocess; never executes document code."""

import resource
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
# macOS rejects RLIMIT_AS values; the container adds a hard memory limit in production.
if sys.platform != "darwin":
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
path, mime = Path(sys.argv[1]), sys.argv[2]
if mime == "application/pdf":
    from pypdf import PdfReader

    reader = PdfReader(path, strict=True)
    if len(reader.pages) > 100 or reader.is_encrypted:
        raise ValueError("PDF exceeds extraction policy")
    pieces = []
    pages = []
    length = 0
    for number, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "")[:min(25000, 250000 - length)]
        pages.append({"page": number, "start": length, "end": length + len(text)})
        pieces.append(text)
        length += len(text) + 1
        if length >= 250000:
            break
    print(json.dumps({"text": "\n".join(pieces)[:250000], "pages": pages}))
else:
    with zipfile.ZipFile(path) as archive:
        if sum(i.file_size for i in archive.infolist()) > 20 * 1024 * 1024:
            raise ValueError("DOCX exceeds extraction policy")
        if any("vbaProject" in i.filename for i in archive.infolist()):
            raise ValueError("Macros are forbidden")
        data = archive.read("word/document.xml")
        if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
            raise ValueError("XML entities are forbidden")
        root = ElementTree.fromstring(data)
        print(json.dumps({"text": " ".join(root.itertext())[:250000], "pages": []}))
