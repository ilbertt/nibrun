# syntax=docker/dockerfile:1
ARG BUILDER_IMAGE

FROM ${BUILDER_IMAGE} AS toolchain
SHELL ["/bin/sh", "-ec"]
RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "30";\n' >/etc/apt/apt.conf.d/80-nibrun-network; \
    apt-get -o APT::Update::Error-Mode=any update; \
    apt-get install -y --no-install-recommends binutils file musl-dev musl-tools unzip make bzip2

ENV CFLAGS="-std=c11 -D_GNU_SOURCE -Os -static -Wall -Wextra -Werror -Wshadow -Wvla -fno-common -Wl,--build-id=none"
ENV GUEST_SQLITE_SOURCES="/build/src/clock.c /build/src/guest-sqlite-worker.c /build/src/guest-sqlite.c /build/src/log.c /build/src/sqlite-database.c /build/src/sqlite-hrana-batch.c /build/src/sqlite-hrana-pipeline.c /build/src/sqlite-hrana-statements.c /build/src/sqlite-values.c"
ARG SQLITE_ARCHIVE
ARG SQLITE_SHA256
ADD --checksum=sha256:${SQLITE_SHA256} https://www.sqlite.org/2026/${SQLITE_ARCHIVE} /sqlite.zip
RUN unzip -q /sqlite.zip -d /sqlite; \
    musl-gcc -std=c11 -D_GNU_SOURCE -Os -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION \
      -DSQLITE_TEMP_STORE=3 -DSQLITE_DEFAULT_MEMSTATUS=0 -DSQLITE_ENABLE_COLUMN_METADATA \
      -DSQLITE_ENABLE_FTS5 -c /sqlite/sqlite-amalgamation-3530400/sqlite3.c -o /sqlite.o
ARG JANSSON_VERSION
ARG JANSSON_SHA256
ADD --checksum=sha256:${JANSSON_SHA256} https://github.com/akheron/jansson/releases/download/v${JANSSON_VERSION}/jansson-${JANSSON_VERSION}.tar.bz2 /jansson.tar.bz2
RUN mkdir /jansson; tar -xjf /jansson.tar.bz2 -C /jansson --strip-components=1; \
    cd /jansson; CC=musl-gcc CFLAGS="-Os" ./configure --disable-shared --enable-static --prefix=/jansson-built; \
    make -j2; make install
ENV SQLITE_INCLUDES="-I/sqlite/sqlite-amalgamation-3530400 -I/jansson-built/include"
ENV SQLITE_LINK="${SQLITE_INCLUDES} /sqlite.o /jansson-built/lib/libjansson.a -lm"
WORKDIR /build
COPY src/ /build/src/


FROM toolchain AS build
RUN mkdir /objects; \
    for source in ${GUEST_SQLITE_SOURCES}; do \
      musl-gcc ${CFLAGS} ${SQLITE_INCLUDES} -c "$source" -o "/objects/$(basename "$source" .c).o"; \
    done; \
    ar rcs /libnibrun-guest-sqlite.a /objects/*.o

FROM scratch AS library
COPY --from=build /libnibrun-guest-sqlite.a /libnibrun-guest-sqlite.a

FROM build AS tests
COPY tests/ /build/tests/
RUN musl-gcc ${CFLAGS} -o /test-sqlite-hrana /build/tests/test-sqlite-hrana.c /libnibrun-guest-sqlite.a ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-hrana-server /build/tests/test-hrana-server.c /libnibrun-guest-sqlite.a ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-guest-sqlite /build/tests/test-guest-sqlite.c /libnibrun-guest-sqlite.a ${SQLITE_LINK}; \
    musl-gcc ${CFLAGS} -o /test-sqlite-database /build/tests/test-sqlite-database.c /libnibrun-guest-sqlite.a ${SQLITE_LINK}

FROM tests AS hrana-test-server
ENTRYPOINT ["/test-hrana-server"]

FROM tests AS unit-test
RUN /test-sqlite-hrana && /test-guest-sqlite && /test-sqlite-database
