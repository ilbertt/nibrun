-- An artifact the api fetched rather than took delivery of. The bytes are addressed by their
-- digest and named by the file at the end of the url, so neither of those says where they came
-- from — and where they came from is the only part of such a deploy that could be repeated.
--
-- Null for every upload: nothing sent from a browser or a terminal has a url anyone else could
-- follow. Never sent anywhere: a host is told a digest and a key, and this is the control plane's
-- own record of where it found the bytes.

ALTER TABLE nibrun.artifacts
  ADD COLUMN original_file_url text;
