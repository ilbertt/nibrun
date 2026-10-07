# syntax=docker/dockerfile:1
#
# Build with --target init for the binary, --target unit-test to run the tests that
# need nothing but a process, or --target mount-test for an image whose entrypoint
# exercises the mount sequence against a real kernel.

ARG BUILDER_IMAGE

FROM ${BUILDER_IMAGE} AS toolchain
ARG DEBIAN_SNAPSHOT
SHELL ["/bin/sh", "-ec"]
# http, not https: the slim base carries no CA bundle, and apt verifies the
# archive's own signature regardless of transport.
RUN rm -f /etc/apt/sources.list.d/debian.sources; \
    echo "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT} trixie main" \
      >/etc/apt/sources.list; \
    apt-get -o Acquire::Retries=5 update; \
    apt-get install -y --no-install-recommends binutils file musl-dev musl-tools unzip

# musl, not glibc: this is PID 1 in every microVM, so its resident memory is
# multiplied by how many VMs a host packs. Only the tenant's own binary needs glibc,
# and the rootfs carries glibc for exactly that reason.
ENV CFLAGS="-std=c11 -D_GNU_SOURCE -Os -static -Wall -Wextra -Werror -Wshadow -Wvla -fno-common -Wl,--build-id=none"
ENV RUNTIME_SOURCES="/build/src/clock.c /build/src/config.c /build/src/cron-command.c /build/src/crontab.c /build/src/guest-control.c /build/src/guest-cron.c /build/src/guest-filesystem.c /build/src/guest-logs.c /build/src/log.c /build/src/mounts.c /build/src/sqlite-query.c /build/src/sqlite-database.c /build/src/sqlite-wire.c /build/src/supervise.c /build/src/tenant-process.c"
ARG SQLITE_ARCHIVE
ARG SQLITE_SHA256
ADD --checksum=sha256:${SQLITE_SHA256} https://www.sqlite.org/2026/${SQLITE_ARCHIVE} /sqlite.zip
RUN unzip -q /sqlite.zip -d /sqlite; \
    musl-gcc -std=c11 -D_GNU_SOURCE -Os -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION \
      -DSQLITE_TEMP_STORE=3 -DSQLITE_DEFAULT_MEMSTATUS=0 -DSQLITE_ENABLE_COLUMN_METADATA \
      -DSQLITE_ENABLE_FTS5 -c /sqlite/sqlite-amalgamation-3530400/sqlite3.c -o /sqlite.o
ENV SQLITE_LINK="-I/sqlite/sqlite-amalgamation-3530400 /sqlite.o -lm"
WORKDIR /build
COPY src/ /build/src/


FROM toolchain AS build
RUN musl-gcc ${CFLAGS} -s -o /init /build/src/init.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    file /init; \
    size /init; \
    if readelf -l /init | grep -q INTERP; then echo '/init is dynamically linked' >&2; exit 1; fi

FROM scratch AS init
COPY --from=build /init /init


FROM toolchain AS tests
COPY tests/ /build/tests/
RUN musl-gcc ${CFLAGS} -o /test-sqlite-query /build/tests/test-sqlite-query.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-sqlite-database /build/tests/test-sqlite-database.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-sqlite-wire /build/tests/test-sqlite-wire.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /fake-tenant /build/tests/fake-tenant.c; \
    musl-gcc ${CFLAGS} -o /test-guest-cron /build/tests/test-guest-cron.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-cron-command /build/tests/test-cron-command.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-crontab /build/tests/test-crontab.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-config /build/tests/test-config.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-supervise /build/tests/test-supervise.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-filesystem /build/tests/test-filesystem.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-mounts /build/tests/test-mounts.c ${RUNTIME_SOURCES} ${SQLITE_LINK}

FROM tests AS unit-test
COPY --from=build /init /init
RUN /test-sqlite-query && /test-sqlite-database && /test-sqlite-wire && /test-guest-cron && /test-cron-command && /test-crontab && /test-config && /test-supervise && /test-filesystem
RUN ln -s /init /crontab; \
    status=0; /crontab -e 2>/tmp/crontab-usage || status=$?; \
    test "$status" = 1; grep -q '^Usage: crontab ' /tmp/crontab-usage

FROM tests AS block-devices
RUN apt-get install -y --no-install-recommends e2fsprogs mount squashfs-tools util-linux

FROM block-devices AS mount-test
ENTRYPOINT ["/bin/sh", "/build/tests/mounts.sh"]

FROM block-devices AS boot-test
COPY --from=build /init /init
# The mount points /init cannot create for itself: in the guest they are directories
# the rootfs image carries, because the root is read-only.
RUN mkdir -p /mnt/artifact /app
ENTRYPOINT ["/bin/sh", "/build/tests/boot.sh"]
