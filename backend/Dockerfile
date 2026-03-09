# =====================================================================
# FormReminder - Backend Dockerfile
# Place this file at: backend/Dockerfile
# =====================================================================

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=True

ENV APP_HOME=/app
WORKDIR $APP_HOME

# Copy requirements first for better layer caching
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend source code
COPY . ./

# Cloud Run injects the PORT env variable automatically (default 8080)
# --workers 1 is intentional: Flask sessions are in-memory, multiple workers
# would cause session state to be split across processes.
# --threads 8 handles concurrent requests within the single worker.
# If you later move to a shared session store (e.g. Redis), you can increase workers.
CMD exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 120 wsgi:app
