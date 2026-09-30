#ifndef NIBRUN_CRONTAB_H
#define NIBRUN_CRONTAB_H

#include <stdbool.h>
#include <stddef.h>

/* NBC1 matches the agent's lib/cron/registration-protocol.ts. Acknowledgement
 * means the agent has persisted the replacement; the guest keeps no copy. */
#define CRONTAB_MAGIC "NBC1"
#define CRONTAB_HEADER_BYTES 9
#define CRONTAB_MAX_BYTES 65536

enum crontab_verb { CRONTAB_REPLACE = 1, CRONTAB_LIST = 2 };
enum crontab_status { CRONTAB_OK = 0, CRONTAB_REJECTED = 1 };

struct crontab_arguments {
  int count;
  char **values;
};

struct crontab_options {
  bool valid;
  enum crontab_verb verb;
  bool read_input;
  const char *path;
};

struct crontab_exchange {
  int connection;
  const unsigned char *source;
  size_t length;
  int output;
  int errors;
  enum crontab_verb verb;
};

struct crontab_source {
  int descriptor;
  unsigned char bytes[CRONTAB_MAX_BYTES];
  size_t length;
};

bool crontab_read_source(struct crontab_source *source);
struct crontab_options crontab_parse_options(const struct crontab_arguments *arguments);
int crontab_exchange(const struct crontab_exchange *exchange);
int crontab_main(const struct crontab_arguments *arguments);

#endif
