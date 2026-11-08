FROM python:3.12-slim
ARG RELEASE_SHA=local
LABEL org.opencontainers.image.revision=$RELEASE_SHA
ENV RELEASE_SHA=$RELEASE_SHA
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PATH=/app/.venv/bin:$PATH
RUN pip install --no-cache-dir uv==0.12.19
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY spec.py ./
RUN python -c 'from huggingface_hub import snapshot_download; from spec import MODEL_ID, MODEL_REVISION; snapshot_download(MODEL_ID, revision=MODEL_REVISION, local_dir="/opt/model")'
COPY service.py ./
ENV MODEL_PATH=/opt/model HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 TOKENIZERS_PARALLELISM=false
RUN useradd --uid 10001 --no-create-home fyde
USER 10001:10001
EXPOSE 8080
CMD ["gunicorn", "service:app", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "1", "--timeout", "180", "--error-logfile", "-"]
