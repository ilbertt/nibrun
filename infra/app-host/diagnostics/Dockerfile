FROM minio/minio:RELEASE.2025-09-07T16-13-09Z AS object-store
FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends fuse3 util-linux && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir boto3==1.40.56
COPY --from=object-store /usr/bin/minio /tools/minio
COPY reproduce.py /tools/reproduce.py
ENTRYPOINT ["python3", "/tools/reproduce.py"]
