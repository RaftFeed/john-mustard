FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir flask gunicorn numpy matplotlib pandas pymupdf pillow openpyxl

COPY server.py .

EXPOSE 8000

CMD ["gunicorn", "-w", "2", "-b", "0.0.0.0:8000", "server:app"]
