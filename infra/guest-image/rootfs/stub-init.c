/* Stands in for apps/runtime's /init so the rootfs can be built and booted
 * before that component exists. It is not a guest init: it prints and exits,
 * which under PID 1 is a panic. Never publish an image built with it — the
 * version digest covers /init, so one built with this can never collide with a
 * real one.
 *
 * It reports argv and envp because the kernel hands PID 1 every command-line
 * token it did not consume itself, and a boot test that does not print them
 * cannot tell you whether argv[1] is meaningful or is `i8042.noaux`. */
#include <stdio.h>

int main(int argc, char **argv, char **envp) {
  puts("nibrun guest-image stub init: not the real /init");
  for (int i = 0; i < argc; i++) {
    printf("stub-init argv[%d]=%s\n", i, argv[i]);
  }
  for (char **entry = envp; *entry != NULL; entry++) {
    printf("stub-init envp=%s\n", *entry);
  }
  return 0;
}
