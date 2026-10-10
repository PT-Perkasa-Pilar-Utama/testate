# ADR 0005: A moved database leaves its old project's states

- **Date:** 2026-10-10
- **Status:** Accepted (decided by the advisor at the user's request; #77, M2 of `docs/decisions/2026-10-10-move-adapter.md`)

## Context

An adapter can move to another project (#77). A database is part of its project's history: every state of that project holds a manifest of it, the init state included, because a database gets an init snapshot when it joins. Today a checkout finds a state's adapter by id alone, so after a move a restore of an old state of the source project would write that project's data into a database the destination now owns.

The alternatives were to refuse moving any database a state holds, which blocks nearly every database move since the init state holds them all; to restore the database to the source project's init first, which rewrites data its owner meant to keep; or to let the database leave the source project's history.

## Decision

A move marks the database's manifests `removed` in every state of the source project, as deleting an adapter does, and restores nothing. The database keeps what it holds now. The source project's states can no longer restore it; its other databases restore as before. The move dialog says so before the confirm. A checkout also treats an adapter whose project is not the state's project as removed, so no manifest can reach a database outside its project.

## Consequences

The move cannot be undone into history: moving the database back does not make the old states restore it again, since their manifests stay removed. A database that needs its source project's starting point back must be restored there before it moves. Restoring first remains the upgrade path, through the deletion plan's restore-or-skip choice, if a case asks for it.
