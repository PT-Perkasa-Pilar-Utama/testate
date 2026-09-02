-- Whether the live databases still match HEAD.
--
-- HEAD says which state the databases were last put on. It said nothing about what happened since:
-- a write session, an import, or the system under test running for an hour all leave HEAD pointing
-- at a state the databases no longer hold, and the screen kept offering the same Check out as if
-- nothing had moved. A checkout and a snapshot reset this to 0, because both leave the databases
-- equal to the state HEAD names. Testate's own writes set it to 1. A diff of HEAD against the live
-- databases settles it either way, which is the only way an outside write can be seen.
ALTER TABLE projects ADD COLUMN head_dirty INTEGER NOT NULL DEFAULT 0;
