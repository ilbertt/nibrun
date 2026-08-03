#ifndef NIBRUN_PATHS_H
#define NIBRUN_PATHS_H

/* The guest boot contract, as constants. Firecracker assigns virtio-blk devices in
 * the order its `drives` array declares them, so the device names below are an
 * agreement with the host agent, not a local choice. Every mount point except the
 * ones on a tmpfs has to already exist in the rootfs image: the root is read-only
 * for the life of the VM, so nothing can create a directory on it at boot. */

#define ARTIFACT_DEVICE "/dev/vdb"
#define CONFIG_DEVICE "/dev/vdc"
#define DATA_DEVICE "/dev/vdd"

#define ARTIFACT_MOUNT "/mnt/artifact"
#define TENANT_BINARY ARTIFACT_MOUNT "/server"

#define CONFIG_MOUNT "/run/config"
#define CONFIG_FILE CONFIG_MOUNT "/instance.env"
#define RESOLV_CONF "/run/resolv.conf"

#define APP_DIR "/app"
#define DATA_DIR APP_DIR "/data"
#define TENANT_TMP_DIR "/tmp"

/* Debian's own numbering, and what the rootfs image names in /etc/passwd. */
#define TENANT_UID 65534
#define TENANT_GID 65534

#endif
