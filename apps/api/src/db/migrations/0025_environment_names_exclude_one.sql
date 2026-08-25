-- `__proto__` is not a name a variable may have.
--
-- It matches the shell's rule, and an environment travels from here to a host as a JavaScript
-- object, where writing that key sets a prototype rather than a property: the value would be
-- accepted here and then be silently gone by the time anything read it back. Refusing it is what
-- turns that into an answer an owner gets.
--
-- This restates ENVIRONMENT_NAME_PATTERN from @repo/protocol, which carves out the same name with
-- a lookahead, and nothing compares the two — so changing it there is still a migration here. It
-- is spelled as a second condition rather than as one regex, because the exception is worth
-- reading as one.
--
-- NOT VALID, so this is a rule about what may be written from now on. A row that predates it holds
-- a variable nothing has ever carried to a host, and this table refuses deletes, so validating
-- against one would fail every deploy over a row nobody can remove.

ALTER TABLE nibrun.app_config_environment
  DROP CONSTRAINT app_config_environment_name_check;

ALTER TABLE nibrun.app_config_environment
  ADD CONSTRAINT app_config_environment_name_check
  CHECK (name ~ '^[A-Za-z_][A-Za-z0-9_]*$' AND name <> '__proto__') NOT VALID;
