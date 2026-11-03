# syntax=docker/dockerfile:1
ARG RUNTIME_TOOLCHAIN=nibrun-guest-runtime:build
FROM ${RUNTIME_TOOLCHAIN} AS build
RUN apt-get install -y --no-install-recommends e2fsprogs
COPY init.c /image-init.c
COPY tests/app.c /image-test-app.c
RUN musl-gcc ${CFLAGS} -s -I/build/src -o /image-init /image-init.c ${RUNTIME_SOURCES} ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -s -o /image-test-app /image-test-app.c ${SQLITE_LINK}; \
    if readelf -l /image-init | grep -q INTERP; then exit 1; fi

COPY --from=stock rootfs.ext4 /stock/rootfs.ext4
COPY --from=stock manifest.json /stock/manifest.json
COPY patch-image.sh /patch-image.sh
RUN mkdir /output; bash /patch-image.sh /output/rootfs.ext4; \
    bash /patch-image.sh /second.ext4; cmp /output/rootfs.ext4 /second.ext4
RUN debugfs -R 'dump /init /installed-init' /output/rootfs.ext4; \
    cmp /image-init /installed-init; \
    debugfs -R 'dump /usr/lib/nibrun/nibrunner-init /stock-init' /output/rootfs.ext4; \
    expected=$(sed -n 's/.*"init_sha256": "\([a-f0-9]*\)".*/\1/p' /stock/manifest.json); \
    printf '%s  /stock-init\n' "$expected" | sha256sum --check; \
    install -D -m 0755 /stock-init /usr/lib/nibrun/nibrunner-init; \
    ln -s /image-init /crontab; status=0; /crontab -e 2>/tmp/crontab-usage || status=$?; \
    test "$status" = 1; grep -q '^Usage:' /tmp/crontab-usage

FROM scratch AS image
COPY --from=build /output/rootfs.ext4 /rootfs.ext4
COPY --from=build /image-init /image-init
COPY --from=build /image-test-app /test-app
