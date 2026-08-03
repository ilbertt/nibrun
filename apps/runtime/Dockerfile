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
    apt-get install -y --no-install-recommends binutils file musl-dev musl-tools

# musl, not glibc: this is PID 1 in every microVM, so its resident memory is
# multiplied by how many VMs a host packs. Only the tenant's own binary needs glibc,
# and the rootfs carries glibc for exactly that reason.
ENV CFLAGS="-std=c11 -D_GNU_SOURCE -Os -static -Wall -Wextra -Werror -Wshadow -Wvla -fno-common -Wl,--build-id=none"
ENV RUNTIME_SOURCES="/build/src/config.c /build/src/log.c /build/src/mounts.c /build/src/supervise.c"
WORKDIR /build
COPY src/ /build/src/


FROM toolchain AS build
RUN musl-gcc ${CFLAGS} -s -o /init /build/src/init.c ${RUNTIME_SOURCES}; \
    file /init; \
    size /init; \
    if readelf -l /init | grep -q INTERP; then echo '/init is dynamically linked' >&2; exit 1; fi

FROM scratch AS init
COPY --from=build /init /init


FROM toolchain AS tests
COPY tests/ /build/tests/
RUN musl-gcc ${CFLAGS} -o /fake-tenant /build/tests/fake-tenant.c; \
    musl-gcc ${CFLAGS} -o /test-config /build/tests/test-config.c ${RUNTIME_SOURCES}; \
    musl-gcc ${CFLAGS} -o /test-supervise /build/tests/test-supervise.c ${RUNTIME_SOURCES}; \
    musl-gcc ${CFLAGS} -o /test-mounts /build/tests/test-mounts.c ${RUNTIME_SOURCES}

FROM tests AS unit-test
RUN /test-config && /test-supervise

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
