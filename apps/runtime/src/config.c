#include "config.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "log.h"
#include "paths.h"

#define RUNTIME_PREFIX "NIBRUN_"
#define ARGUMENT_KEY_PREFIX "ARG_"
#define TENANT_PREFIX "ENV_"

#define MIN_PORT 1
#define MAX_PORT 65535
#define MAX_RESTARTS_LIMIT 100000
#define MAX_DURATION_MS (24 * 60 * 60 * 1000)
#define MIN_BACKOFF_FACTOR 1.0
#define MAX_BACKOFF_FACTOR 1000.0

/* PORT, HOME and TMPDIR, on top of whatever the tenant configured. */
#define BASE_VARIABLES 3

enum field_type {
  FIELD_UNSIGNED,
  FIELD_BACKOFF_FACTOR,
  FIELD_NAMESERVERS,
};

struct field {
  const char *key;
  enum field_type type;
  size_t offset;
  uint32_t minimum;
  uint32_t maximum;
  bool required;
};

static const struct field FIELDS[] = {
    {"PORT", FIELD_UNSIGNED, offsetof(struct instance_config, port), MIN_PORT, MAX_PORT, true},
    {"MAX_RESTARTS", FIELD_UNSIGNED, offsetof(struct instance_config, restart_policy.max_restarts), 0,
     MAX_RESTARTS_LIMIT, true},
    {"INITIAL_BACKOFF_MS", FIELD_UNSIGNED,
     offsetof(struct instance_config, restart_policy.initial_backoff_ms), 0, MAX_DURATION_MS, true},
    {"MAX_BACKOFF_MS", FIELD_UNSIGNED, offsetof(struct instance_config, restart_policy.max_backoff_ms), 0,
     MAX_DURATION_MS, true},
    {"BACKOFF_FACTOR", FIELD_BACKOFF_FACTOR,
     offsetof(struct instance_config, restart_policy.backoff_factor), 0, 0, true},
    {"RESET_AFTER_MS", FIELD_UNSIGNED, offsetof(struct instance_config, restart_policy.reset_after_ms), 0,
     MAX_DURATION_MS, true},
    {"DNS", FIELD_NAMESERVERS, 0, 0, 0, false},
};

#define FIELD_COUNT (sizeof(FIELDS) / sizeof(FIELDS[0]))

static bool starts_with(const char *text, const char *prefix) {
  return strncmp(text, prefix, strlen(prefix)) == 0;
}

static bool parse_unsigned(const char *text, const struct field *field, uint32_t *out) {
  if (*text < '0' || *text > '9') { /* rejects the empty value, signs and leading space */
    return false;
  }
  errno = 0;
  char *end;
  unsigned long long parsed = strtoull(text, &end, 10);
  if (errno != 0 || *end != '\0') {
    return false;
  }
  if (parsed < field->minimum || parsed > field->maximum) {
    return false;
  }
  *out = (uint32_t)parsed;
  return true;
}

static bool parse_backoff_factor(const char *text, double *out) {
  if (*text < '0' || *text > '9') { /* also rejects "nan" and "inf", which strtod would take */
    return false;
  }
  errno = 0;
  char *end;
  double parsed = strtod(text, &end);
  if (errno != 0 || *end != '\0') {
    return false;
  }
  if (!(parsed >= MIN_BACKOFF_FACTOR && parsed <= MAX_BACKOFF_FACTOR)) {
    return false;
  }
  *out = parsed;
  return true;
}

static bool is_ip_address(const char *text) {
  unsigned char address[sizeof(struct in6_addr)];
  return inet_pton(AF_INET, text, address) == 1 || inet_pton(AF_INET6, text, address) == 1;
}

static bool parse_nameservers(struct instance_config *config, char *value) {
  for (;;) {
    char *comma = strchr(value, ',');
    if (comma != NULL) {
      *comma = '\0';
    }
    if (config->nameserver_count == CONFIG_MAX_NAMESERVERS) {
      log_line("%sDNS lists more than %d nameservers", RUNTIME_PREFIX, CONFIG_MAX_NAMESERVERS);
      return false;
    }
    if (!is_ip_address(value)) {
      log_line("%sDNS entry %zu is not an IP address", RUNTIME_PREFIX, config->nameserver_count + 1);
      return false;
    }
    config->nameservers[config->nameserver_count++] = value;
    if (comma == NULL) {
      return true;
    }
    value = comma + 1;
  }
}

static bool assign(struct instance_config *config, const struct field *field, char *value) {
  char *target = (char *)config + field->offset;
  switch (field->type) {
    case FIELD_UNSIGNED: {
      uint32_t parsed;
      if (!parse_unsigned(value, field, &parsed)) {
        log_line("%s%s is not a whole number between %u and %u", RUNTIME_PREFIX, field->key, field->minimum,
                 field->maximum);
        return false;
      }
      *(uint32_t *)target = parsed;
      return true;
    }
    case FIELD_BACKOFF_FACTOR: {
      double parsed;
      if (!parse_backoff_factor(value, &parsed)) {
        log_line("%s%s is not a number between %g and %g", RUNTIME_PREFIX, field->key, MIN_BACKOFF_FACTOR,
                 MAX_BACKOFF_FACTOR);
        return false;
      }
      *(double *)target = parsed;
      return true;
    }
    case FIELD_NAMESERVERS:
      return parse_nameservers(config, value);
  }
  return false;
}

/* NIBRUN_ARG_<n>. Slotted by index rather than appended, so the writer's order is
 * irrelevant and a gap is caught after the whole file is read rather than silently
 * shifting every later argument down one. */
static bool parse_argument(struct instance_config *config, const char *key, char *value, size_t line_number) {
  const char *digits = key + strlen(ARGUMENT_KEY_PREFIX);
  if (*digits == '\0') {
    log_line("instance.env line %zu sets %s%s with no index", line_number, RUNTIME_PREFIX, key);
    return false;
  }

  char *unparsed = NULL;
  errno = 0;
  unsigned long index = strtoul(digits, &unparsed, 10);
  if (errno != 0 || *unparsed != '\0' || index >= CONFIG_MAX_ARGUMENTS) {
    log_line("instance.env line %zu sets %s%s, which is not an index below %d", line_number, RUNTIME_PREFIX,
             key, CONFIG_MAX_ARGUMENTS);
    return false;
  }
  if (config->arguments[index] != NULL) {
    log_line("instance.env sets %s%s twice (line %zu)", RUNTIME_PREFIX, key, line_number);
    return false;
  }

  config->arguments[index] = value;
  config->argument_count++;
  return true;
}

static bool parse_runtime_key(struct instance_config *config, bool *seen, char *line, size_t line_number) {
  char *equals = strchr(line, '=');
  if (equals == NULL) {
    log_line("instance.env line %zu has no '='", line_number);
    return false;
  }
  *equals = '\0';
  const char *key = line + strlen(RUNTIME_PREFIX);

  if (starts_with(key, ARGUMENT_KEY_PREFIX)) {
    return parse_argument(config, key, equals + 1, line_number);
  }

  for (size_t index = 0; index < FIELD_COUNT; index++) {
    if (strcmp(key, FIELDS[index].key) != 0) {
      continue;
    }
    if (seen[index]) {
      log_line("instance.env sets %s%s twice (line %zu)", RUNTIME_PREFIX, key, line_number);
      return false;
    }
    seen[index] = true;
    return assign(config, &FIELDS[index], equals + 1);
  }

  log_line("instance.env line %zu sets %s%s, which this runtime does not know", line_number, RUNTIME_PREFIX,
           key);
  return false;
}

/* Mirrors TenantEnvironmentSchema's name pattern in packages/protocol. */
static bool is_valid_variable_name(const char *name, const char *end) {
  if (name == end) {
    return false;
  }
  for (const char *character = name; character < end; character++) {
    bool letter = (*character >= 'A' && *character <= 'Z') || (*character >= 'a' && *character <= 'z');
    bool digit = *character >= '0' && *character <= '9';
    bool allowed = letter || *character == '_' || (digit && character != name);
    if (!allowed) {
      return false;
    }
  }
  return true;
}

static bool names_match(const char *left, const char *right) {
  const char *left_end = strchr(left, '=');
  const char *right_end = strchr(right, '=');
  size_t left_length = (size_t)(left_end - left);
  return left_length == (size_t)(right_end - right) && strncmp(left, right, left_length) == 0;
}

/* Neither the name nor the value of a tenant variable is ever logged: the config
 * drive carries the tenant's secrets and the console is captured into the host's
 * journal. Line numbers are enough to find the offending line in a generated file. */
static bool parse_tenant_variable(struct instance_config *config, char *line, size_t line_number) {
  char *variable = line + strlen(TENANT_PREFIX);
  const char *equals = strchr(variable, '=');
  if (equals == NULL) {
    log_line("instance.env line %zu has no '='", line_number);
    return false;
  }
  if (!is_valid_variable_name(variable, equals)) {
    log_line("instance.env line %zu is not a valid environment variable name", line_number);
    return false;
  }
  if (config->tenant_variable_count == CONFIG_MAX_TENANT_VARIABLES) {
    log_line("instance.env sets more than %d tenant environment variables", CONFIG_MAX_TENANT_VARIABLES);
    return false;
  }
  for (size_t index = 0; index < config->tenant_variable_count; index++) {
    if (names_match(config->tenant_environment[index], variable)) {
      log_line("instance.env sets the same tenant environment variable twice (line %zu)", line_number);
      return false;
    }
  }
  config->tenant_environment[config->tenant_variable_count++] = variable;
  return true;
}

bool config_parse(struct instance_config *config, char *text, size_t length) {
  memset(config, 0, sizeof(*config));
  bool seen[FIELD_COUNT] = {false};

  /* Both would end up inside a value that looked plausible: a NUL truncates one,
   * and a carriage return appends an invisible byte to one. The file is generated
   * on Linux by the agent, so either means the writer is broken. */
  if (memchr(text, '\0', length) != NULL) {
    log_line("instance.env contains a NUL byte");
    return false;
  }
  if (memchr(text, '\r', length) != NULL) {
    log_line("instance.env contains a carriage return");
    return false;
  }
  /* Every line ends at a newline turned into a terminator; the last one has this
   * instead, whether or not the file ends with a newline of its own. */
  text[length] = '\0';

  char *cursor = text;
  char *end = text + length;
  size_t line_number = 0;
  while (cursor < end) {
    char *line = cursor;
    char *newline = memchr(cursor, '\n', (size_t)(end - cursor));
    if (newline != NULL) {
      *newline = '\0';
      cursor = newline + 1;
    } else {
      cursor = end;
    }
    line_number++;

    if (*line == '\0') {
      continue;
    }
    if (starts_with(line, RUNTIME_PREFIX)) {
      if (!parse_runtime_key(config, seen, line, line_number)) {
        return false;
      }
    } else if (starts_with(line, TENANT_PREFIX)) {
      if (!parse_tenant_variable(config, line, line_number)) {
        return false;
      }
    } else {
      /* Also how a value containing a newline is caught: its second line cannot
       * carry a prefix, so a truncated secret fails the boot instead of reaching
       * the tenant. */
      log_line("instance.env line %zu starts with neither %s nor %s", line_number, RUNTIME_PREFIX,
               TENANT_PREFIX);
      return false;
    }
  }

  for (size_t index = 0; index < FIELD_COUNT; index++) {
    if (FIELDS[index].required && !seen[index]) {
      log_line("instance.env is missing %s%s", RUNTIME_PREFIX, FIELDS[index].key);
      return false;
    }
  }

  /* Every index below the count must be filled, or an argument the user wrote is
   * missing and the tenant would be exec'd with a subtly different command line
   * rather than not at all. */
  for (size_t index = 0; index < config->argument_count; index++) {
    if (config->arguments[index] == NULL) {
      log_line("instance.env skips %sARG_%zu", RUNTIME_PREFIX, index);
      return false;
    }
  }
  return true;
}

static bool is_named(const char *entry, const char *name) {
  size_t length = strlen(name);
  return strncmp(entry, name, length) == 0 && entry[length] == '=';
}

static bool defines(char *const *entries, size_t count, const char *name) {
  for (size_t index = 0; index < count; index++) {
    if (is_named(entries[index], name)) {
      return true;
    }
  }
  return false;
}

char *const *config_build_argv(const struct instance_config *config, const char *executable) {
  static char *argv[CONFIG_MAX_ARGUMENTS + 2];

  size_t count = 0;
  argv[count++] = (char *)executable;
  for (size_t index = 0; index < config->argument_count; index++) {
    argv[count++] = config->arguments[index];
  }
  argv[count] = NULL;
  return argv;
}

char *const *config_build_environment(const struct instance_config *config) {
  static char *environment[CONFIG_MAX_TENANT_VARIABLES + BASE_VARIABLES + 1];
  static char port_variable[sizeof("PORT=65535")];

  snprintf(port_variable, sizeof(port_variable), "PORT=%u", config->port);
  size_t count = 0;
  environment[count++] = port_variable;

  for (size_t index = 0; index < config->tenant_variable_count; index++) {
    if (is_named(config->tenant_environment[index], "PORT")) {
      log_line("ignoring the tenant's own PORT; this instance is served on %u", config->port);
      continue;
    }
    environment[count++] = config->tenant_environment[index];
  }
  if (!defines(environment, count, "HOME")) {
    environment[count++] = "HOME=" APP_DIR;
  }
  if (!defines(environment, count, "TMPDIR")) {
    environment[count++] = "TMPDIR=" TENANT_TMP_DIR;
  }
  environment[count] = NULL;
  return environment;
}

bool config_read_file(struct instance_config *config, const char *path, char *buffer, size_t buffer_size) {
  int descriptor = open(path, O_RDONLY | O_CLOEXEC);
  if (descriptor < 0) {
    log_errno("could not open %s", path);
    return false;
  }

  size_t used = 0;
  for (;;) {
    if (used == buffer_size) {
      log_line("%s is larger than %zu bytes", path, buffer_size);
      close(descriptor);
      return false;
    }
    ssize_t chunk = read(descriptor, buffer + used, buffer_size - used);
    if (chunk < 0) {
      if (errno == EINTR) {
        continue;
      }
      log_errno("could not read %s", path);
      close(descriptor);
      return false;
    }
    if (chunk == 0) {
      break;
    }
    used += (size_t)chunk;
  }
  close(descriptor);

  return config_parse(config, buffer, used);
}
