# syntax=docker/dockerfile:1
#
# Three independent artifacts, one base image. Build with --target kernel, --target
# rootfs or --target stub-init; BuildKit only runs the stage you ask for.

ARG BUILDER_IMAGE

FROM ${BUILDER_IMAGE} AS debian
SHELL ["/bin/sh", "-ec"]
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\n' >/etc/apt/apt.conf.d/80-nibrun-network; \
    apt-get -o APT::Update::Error-Mode=any update


FROM debian AS kernel-builder
ARG KERNEL_VERSION
ARG KERNEL_SHA256
ARG FIRECRACKER_CONFIG_SHA256
ARG SOURCE_DATE_EPOCH

RUN apt-get install -y --no-install-recommends \
      bc bison build-essential ca-certificates curl file flex libelf-dev libssl-dev patch xz-utils

WORKDIR /build/linux
RUN curl -fsSL --retry 5 -o /tmp/linux.tar.xz \
      "https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-${KERNEL_VERSION}.tar.xz"; \
    echo "${KERNEL_SHA256}  /tmp/linux.tar.xz" | sha256sum -c -; \
    tar -xf /tmp/linux.tar.xz --strip-components=1 -C /build/linux; \
    rm /tmp/linux.tar.xz

COPY kernel/ /build/config/

RUN patch --batch --forward --fuzz=0 -p1 \
      < /build/config/patches/ext4-fix-null-folio-dereference-in-mballoc.patch

RUN echo "${FIRECRACKER_CONFIG_SHA256}  /build/config/firecracker-ci-x86_64-6.1.config" \
      | sha256sum -c -; \
    ./scripts/kconfig/merge_config.sh -m -O . \
      /build/config/firecracker-ci-x86_64-6.1.config /build/config/nibrun.config; \
    make olddefconfig; \
    sh /build/config/assert-config.sh .config \
      /build/config/nibrun.config \
      /build/config/firecracker-ci-x86_64-6.1.config \
      /build/config/config-drift.allow

# vmlinux, never bzImage: Firecracker loads an uncompressed ELF and runs no
# real-mode decompressor.
RUN export KBUILD_BUILD_USER=nibrun KBUILD_BUILD_HOST=guest-image \
      KBUILD_BUILD_TIMESTAMP="$(date -u -d "@${SOURCE_DATE_EPOCH}")"; \
    make -j"$(nproc)" vmlinux

RUN file vmlinux; \
    readelf -h vmlinux; \
    file vmlinux | grep -q 'ELF 64-bit LSB.*x86-64'; \
    if file vmlinux | grep -q compressed; then echo 'vmlinux is compressed' >&2; exit 1; fi

FROM scratch AS kernel
COPY --from=kernel-builder /build/linux/vmlinux /vmlinux
COPY --from=kernel-builder /build/linux/.config /kernel.config


FROM debian AS rootfs-builder
ARG SOURCE_DATE_EPOCH
ARG ROOTFS_UUID
ARG ROOTFS_HASH_SEED
ARG ROOTFS_LABEL
ENV DEBIAN_FRONTEND=noninteractive \
    SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH} \
    ROOTFS_UUID=${ROOTFS_UUID} \
    ROOTFS_HASH_SEED=${ROOTFS_HASH_SEED} \
    ROOTFS_LABEL=${ROOTFS_LABEL}

# g++ is not shipped in the image — it compiles the probe that proves the image
# can actually exec a dynamically linked glibc/libstdc++ binary.
RUN apt-get install -y --no-install-recommends e2fsprogs file g++

COPY rootfs/build-rootfs.sh /usr/local/bin/build-rootfs
COPY --from=runtime init /staged-init
RUN build-rootfs

FROM scratch AS rootfs
COPY --from=rootfs-builder /out/ /


# A throwaway stand-in for apps/runtime's /init, so the rootfs can be built and
# checked before that component exists. It changes the computed version, so an
# image built with it can never be mistaken for a publishable one.
FROM debian AS stub-init-builder
RUN apt-get install -y --no-install-recommends binutils gcc libc6-dev
COPY rootfs/stub-init.c /stub-init.c
RUN gcc -static -Os -o /init /stub-init.c; \
    if readelf -l /init | grep -q INTERP; then echo 'stub init is not static' >&2; exit 1; fi

FROM scratch AS stub-init
COPY --from=stub-init-builder /init /init
