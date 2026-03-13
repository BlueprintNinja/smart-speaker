FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir requests
COPY farm_bridge.py .
CMD ["python", "-u", "farm_bridge.py"]
