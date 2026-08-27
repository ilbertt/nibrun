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
#define HOSTNAME_KEY "HOSTNAME"
/* The one runtime key the tenant is handed under its own name, so it is spelled once. */
#define HOSTNAME_VARIABLE RUNTIME_PREFIX HOSTNAME_KEY

/* Only a sigil followed by RUNTIME_PREFIX opens a reference, which is what leaves a
 * secret's own '$' alone — see the format contract in config.h. */
#define REFERENCE_SIGIL '$'
#define REFERENCE_OPEN '{'
#define REFERENCE_CLOSE '}'

#define MIN_PORT 1
#define MAX_PORT 65535
#define MAX_RESTARTS_LIMIT 100000
#define MAX_DURATION_MS (24 * 60 * 60 * 1000)
#define MIN_BACKOFF_FACTOR 1.0
#define MAX_BACKOFF_FACTOR 1000.0

/* PORT, NIBRUN_HOSTNAME, HOME and TMPDIR, on top of whatever the tenant configured. */
#define BASE_VARIABLES 4

enum field_type {
  FIELD_UNSIGNED,
  FIELD_BACKOFF_FACTOR,
  FIELD_NAMESERVERS,
  /* `minimum` and `maximum` bound its length rather than its value. */
  FIELD_TEXT,
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
    {HOSTNAME_KEY, FIELD_TEXT, offsetof(struct instance_config, hostname), 1, CONFIG_MAX_HOSTNAME,
     false},
};

#define FIELD_COUNT (sizeof(FIELDS) / sizeof(FIELDS[0]))

static bool starts_with(const char *text, const char *prefix) {
  return strncmp(text, prefix, strlen(prefix)) == 0;
}

static bool is_digit(char character) {
  return character >= '0' && character <= '9';
}

static bool is_name_character(char character) {
  return (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') ||
         character == '_' || is_digit(character);
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
    case FIELD_TEXT: {
      size_t length = strlen(value);
      if (length < field->minimum || length > field->maximum) {
        log_line("%s%s is not between %u and %u bytes", RUNTIME_PREFIX, field->key, field->minimum,
                 field->maximum);
        return false;
      }
      *(char **)target = value;
      return true;
    }
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
  if (name == end || is_digit(*name)) {
    return false;
  }
  for (const char *character = name; character < end; character++) {
    if (!is_name_character(*character)) {
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

struct reference {
  const char *name;
  size_t length;
  const char *after;
};

static bool at_reference(const char *text) {
  if (*text != REFERENCE_SIGIL) {
    return false;
  }
  const char *name = text + 1;
  if (*name == REFERENCE_OPEN) {
    name++;
  }
  return starts_with(name, RUNTIME_PREFIX);
}

static const char *find_reference(const char *value) {
  for (const char *cursor = strchr(value, REFERENCE_SIGIL); cursor != NULL;
       cursor = strchr(cursor + 1, REFERENCE_SIGIL)) {
    if (at_reference(cursor)) {
      return cursor;
    }
  }
  return NULL;
}

/* `text` starts at a sigil at_reference has already accepted, so the only way this
 * fails is a braced form nobody closed — a typo rather than a value meant literally. */
static bool read_reference(const char *text, struct reference *out) {
  const char *cursor = text + 1;
  bool braced = *cursor == REFERENCE_OPEN;
  if (braced) {
    cursor++;
  }
  out->name = cursor;
  while (is_name_character(*cursor)) {
    cursor++;
  }
  out->length = (size_t)(cursor - out->name);
  if (braced) {
    if (*cursor != REFERENCE_CLOSE) {
      log_line("a tenant variable names %.*s with no closing '%c'", (int)out->length, out->name,
               REFERENCE_CLOSE);
      return false;
    }
    cursor++;
  }
  out->after = cursor;
  return true;
}

static bool names_key(const struct reference *reference, const char *key) {
  const char *name = reference->name + strlen(RUNTIME_PREFIX);
  size_t length = reference->length - strlen(RUNTIME_PREFIX);
  return length == strlen(key) && strncmp(name, key, length) == 0;
}

/* The runtime values a tenant is handed, and nothing else: the restart budget and the
 * nameservers are the supervisor's own and describe nothing a binary could act on.
 * Rendered from the parsed config rather than read back out of the file, so a
 * reference and the variable exported beside it cannot disagree. `*out` is NULL for a
 * name this runtime offers but this instance was not given. */
static bool reference_value(const struct instance_config *config, const struct reference *reference,
                            char *rendered, size_t rendered_size, const char **out) {
  if (names_key(reference, "PORT")) {
    snprintf(rendered, rendered_size, "%u", config->port);
    *out = rendered;
    return true;
  }
  if (names_key(reference, HOSTNAME_KEY)) {
    *out = config->hostname;
    return true;
  }
  return false;
}

/* `overflowed` is poisoned by the first overrun rather than returned, so building a
 * value reads as the concatenation it is and the caller asks once at the end. */
struct arena {
  char *cursor;
  const char *end;
  bool overflowed;
};

static void append(struct arena *arena, const char *text, size_t length) {
  if (arena->overflowed || (size_t)(arena->end - arena->cursor) < length) {
    arena->overflowed = true;
    return;
  }
  memcpy(arena->cursor, text, length);
  arena->cursor += length;
}

/* `entry` is "NAME=value". Left pointing into the file when the value names nothing,
 * which is almost every one of them. */
static bool expand_entry(const struct instance_config *config, struct arena *arena, char **entry) {
  const char *value = strchr(*entry, '=') + 1;
  if (find_reference(value) == NULL) {
    return true;
  }

  char *expansion = arena->cursor;
  append(arena, *entry, (size_t)(value - *entry));

  for (const char *remaining = value;;) {
    const char *found = find_reference(remaining);
    if (found == NULL) {
      append(arena, remaining, strlen(remaining));
      break;
    }
    append(arena, remaining, (size_t)(found - remaining));

    struct reference reference;
    if (!read_reference(found, &reference)) {
      return false;
    }
    /* uint32_t's whole range rather than the port's: anything narrower is a
     * truncation the compiler is right to refuse. */
    char rendered[sizeof("4294967295")];
    const char *substitution;
    if (!reference_value(config, &reference, rendered, sizeof(rendered), &substitution)) {
      log_line("a tenant variable names %.*s, which is not a name this runtime offers",
               (int)reference.length, reference.name);
      return false;
    }
    if (substitution == NULL) {
      log_line("a tenant variable names %.*s, which this instance was not given",
               (int)reference.length, reference.name);
      return false;
    }
    append(arena, substitution, strlen(substitution));
    remaining = reference.after;
  }
  append(arena, "", 1);

  if (arena->overflowed) {
    log_line("instance.env expands to more than %d bytes", CONFIG_MAX_EXPANDED_BYTES);
    return false;
  }
  *entry = expansion;
  return true;
}

/* Last, because the file states its keys in whatever order the writer chose: what a
 * reference resolves to is only settled once every line has been read. */
static bool expand_tenant_values(struct instance_config *config) {
  static char expanded[CONFIG_MAX_EXPANDED_BYTES];
  struct arena arena = {expanded, expanded + sizeof(expanded), false};

  for (size_t index = 0; index < config->tenant_variable_count; index++) {
    if (!expand_entry(config, &arena, &config->tenant_environment[index])) {
      return false;
    }
  }
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
  return expand_tenant_values(config);
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
  static char hostname_variable[sizeof(HOSTNAME_VARIABLE "=") + CONFIG_MAX_HOSTNAME];

  snprintf(port_variable, sizeof(port_variable), "PORT=%u", config->port);
  size_t count = 0;
  environment[count++] = port_variable;
  if (config->hostname != NULL) {
    snprintf(hostname_variable, sizeof(hostname_variable), "%s=%s", HOSTNAME_VARIABLE,
             config->hostname);
    environment[count++] = hostname_variable;
  }

  for (size_t index = 0; index < config->tenant_variable_count; index++) {
    if (is_named(config->tenant_environment[index], "PORT")) {
      log_line("ignoring the tenant's own PORT; this instance is served on %u", config->port);
      continue;
    }
    /* Dropped whether or not one was written: the name belongs to the platform, so a
     * value the tenant set would read as issued by it. */
    if (is_named(config->tenant_environment[index], HOSTNAME_VARIABLE)) {
      log_line("ignoring the tenant's own %s; the platform owns that name", HOSTNAME_VARIABLE);
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
