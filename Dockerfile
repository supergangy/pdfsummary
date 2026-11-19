# 태블릿·폰 앱이 붙는 필기 요약 서버
#   docker build -t pdfsummary-server .
#   docker run -p 8080:8080 -e PDFSUMMARY_ACCESS_CODE=긴-접속-코드 -v pdfsummary-sync:/data pdfsummary-server
#   (필기 앱 실시간 동기화 기록은 /data 에 남는다 — 서버를 다시 만들어도 지워지지 않게 볼륨을 붙인다)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app
COPY pyproject.toml README.md ./
COPY pdfsummary ./pdfsummary
RUN pip install --no-cache-dir . \
    && (python -m pdfsummary.ocr --download --dest /app/ocr_models || echo "글자 인식 모델은 처음 쓸 때 받습니다") \
    && useradd --create-home --uid 10001 app
ENV PDFSUMMARY_MODELS=/app/ocr_models \
    PDFSUMMARY_SYNC_DIR=/data/sync
RUN mkdir -p /data && chown app /data
VOLUME /data
USER app

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8080\")}/healthz')"
CMD ["sh", "-c", "python -m pdfsummary.app --server --host 0.0.0.0 --port ${PORT}"]
