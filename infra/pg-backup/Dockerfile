# Nightly logical Postgres backup to S3. postgresql17-client pins the dump tools
# to the server's major (postgres:17-alpine in the compose file) so pg_dumpall
# never runs against a newer server — bump both together. supercronic instead of
# busybox crond: it passes the container environment to jobs and logs them to
# stdout.
FROM alpine:3.23

RUN apk add --no-cache postgresql17-client aws-cli supercronic

COPY backup.sh /usr/local/bin/backup.sh
COPY crontab /etc/pg-backup-crontab

ENTRYPOINT ["supercronic", "-passthrough-logs", "/etc/pg-backup-crontab"]
