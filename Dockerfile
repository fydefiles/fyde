FROM python:3.12-slim
ARG RELEASE_SHA=local
LABEL org.opencontainers.image.revision=$RELEASE_SHA
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH=/app/.venv/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.12.19
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
RUN groupadd --gid 10001 fyde && useradd --uid 10001 --gid fyde --no-create-home fyde && mkdir -p /app/var /data/private /data/marketing /company/marketing && chown -R fyde:fyde /app/var /data /company
RUN FYDE_VAR_DIR=/tmp/fyde-build DJANGO_DEBUG=1 python manage.py collectstatic --noinput && cp -r /tmp/fyde-build/static /app/static-collected && rm -rf /tmp/fyde-build
ENV RELEASE_SHA=$RELEASE_SHA
USER 10001:10001
EXPOSE 8000
CMD ["gunicorn", "fyde.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "30", "--access-logfile", "/dev/null"]
