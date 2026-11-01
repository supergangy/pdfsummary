# 태블릿·폰 앱이 붙는 필기 요약 서버
#   docker build -t pdfsummary-server .
#   docker run -p 8080:8080 -e PDFSUMMARY_ACCESS_CODE=긴-접속-코드 pdfsummary-server
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app
COPY pyproject.toml README.md ./
COPY pdfsummary ./pdfsummary
RUN pip install --no-cache-dir . \
    && useradd --create-home --uid 10001 app
USER app

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8080\")}/healthz')"
CMD ["sh", "-c", "python -m pdfsummary.app --server --host 0.0.0.0 --port ${PORT}"]
