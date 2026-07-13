import sys
try:
    from pypdf import PdfReader
except ImportError:
    from PyPDF2 import PdfReader

pdf_path = "/home/z/my-project/upload/Backtesting de una Estrategia de Tranching para Capital de Supervivencia en Argentina_ Validación Cuantitativa y Gestión de Riesgos de Cola (Junio 2024 - Junio 2026.pdf"
out_path = "/home/z/my-project/upload/qwen_r5_full.txt"

reader = PdfReader(pdf_path)
with open(out_path, "w", encoding="utf-8") as f:
    for i, page in enumerate(reader.pages, 1):
        f.write(f"=== PAGE {i} ===\n")
        text = page.extract_text() or ""
        f.write(text + "\n")

print(f"Pages: {len(reader.pages)}")
print(f"Saved to: {out_path}")
