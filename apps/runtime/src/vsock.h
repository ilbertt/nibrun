#ifndef NIBRUN_VSOCK_H
#define NIBRUN_VSOCK_H

#include <stdint.h>
#include <sys/socket.h>

/* One Firecracker vsock device serves the whole VM, so every port below multiplexes
 * over it. Tenant output goes out on TENANT_LOG_VSOCK_PORT; the host comes in on
 * GUEST_CONTROL_VSOCK_PORT. The host agent's `lib/vm/vsock.ts` is the other end. */
#define TENANT_LOG_VSOCK_PORT 51000U
#define GUEST_CONTROL_VSOCK_PORT 51001U

#ifndef AF_VSOCK
#define AF_VSOCK 40
#endif
#define VMADDR_CID_HOST 2U
#define VMADDR_CID_ANY 0xFFFFFFFFU

/* The static musl toolchain deliberately carries no Linux header bundle. This is
 * the stable 16-byte UAPI address, kept local so adding one socket family does not
 * add kernel headers to the guest runtime's build input. */
struct vsock_address {
  sa_family_t family;
  unsigned short reserved;
  uint32_t port;
  uint32_t cid;
  unsigned char zero[sizeof(struct sockaddr) - sizeof(sa_family_t) - sizeof(unsigned short) -
                     sizeof(uint32_t) - sizeof(uint32_t)];
};

_Static_assert(sizeof(struct vsock_address) == sizeof(struct sockaddr), "vsock address has the wrong ABI");

#endif
