FROM --platform=linux/arm64 python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY api /app/api
# data/load.py + scripts/ are bundled so the same image can run as a
# one-shot Fargate loader via `aws ecs run-task` with override command.
# data/output/* is downloaded from S3 at run time (not baked into image).
COPY data /app/data
COPY scripts /app/scripts

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
