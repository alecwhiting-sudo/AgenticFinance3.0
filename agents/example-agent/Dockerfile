FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

# Railway injects PORT at runtime.
ENV PORT=8000
CMD ["sh", "-c", "uvicorn example_agent.main:app --host 0.0.0.0 --port ${PORT}"]
