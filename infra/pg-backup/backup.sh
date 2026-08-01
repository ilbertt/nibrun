#!/bin/sh
# Dumps every database in the cluster and streams it to S3. Connection comes
# from PGHOST/PGUSER/PGPASSWORD; AWS credentials come from the instance role
# via IMDS (the instance allows two hops so containers can reach it).
set -eu

: "${BACKUP_BUCKET:?}"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
pg_dumpall | gzip | aws s3 cp - "s3://${BACKUP_BUCKET}/backups/pg-${stamp}.sql.gz"
echo "uploaded backups/pg-${stamp}.sql.gz"
