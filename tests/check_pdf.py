import sys
from pypdf import PdfReader
for name in sys.argv[1:]:
    text = "".join(page.extract_text() for page in PdfReader(name).pages)
    assert text == "[1 user]\n한글 日本語 😀\nsecond line\n", (name, repr(text))
    print(name, "Unicode, role, order and newline extraction: PASS")
