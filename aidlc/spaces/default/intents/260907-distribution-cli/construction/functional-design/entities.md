# Entity Model — aidlc-fleet Distribution CLI

Two entities, both already established by Domain Design (`components.md`)
and refined into full field shapes by Contract Design
(`contract-summary.md`). No relationship exists between them at the data
level — comparison, not reference, is how `VersionGate` and
`DriftDetector` relate them (see Q2 in `functional-design-questions.md`).

## Entity Model (machine-readable)

```yaml
entities:
  - name: Lockfile
    description: >
      The single source of on-disk project state. One Lockfile per
      project, written at <project root>/aidlc.lock.json. Owned and
      authored solely by LockfileStore; this CLI's own commands are the
      only writers (contract-summary.md Contract 2).
    identifier: project path (one lockfile per project; no explicit id field)
    attributes:
      - name: schema
        type: integer
        required: true
        unique: false
        default: 1
        constraints: version marker; consumers must ignore an unrecognized value rather than guess its meaning
      - name: channel
        type: string
        required: true
        unique: false
        constraints: name of the channel this project follows, e.g. "stable"
      - name: channel_commit
        type: string
        required: true
        unique: false
        constraints: commit SHA of the channel declaration this lockfile was last synced against
      - name: engine
        type: object
        required: true
        unique: false
        constraints: "nested — see engine sub-object below"
      - name: engine_origin
        type: string
        required: true
        unique: false
        constraints: the engine version this CLI first installed; the §4 version-gate anchor (v0.1 §4, M3)
      - name: plugins
        type: array<object>
        required: true
        unique: false
        defaults: "[]"
        constraints: "each element — see plugin sub-object below"
      - name: managed
        type: array<string>
        required: true
        unique: false
        defaults: "[]"
        constraints: marker identifiers for BEGIN/END-managed blocks (v0.1 §7)
      - name: known_failures
        type: array<string>
        required: true
        unique: false
        defaults: "[]"
        constraints: doctor findings accepted as known; consumed by SuccessVerifier
      - name: pin
        type: string | null
        required: false
        unique: false
        default: "null"
        constraints: per-project pin override (C1, ADR-004); when set, overrides the channel's resolved latest ref
    entity_constraints:
      - "missing or malformed file is a hard failure for every command except init, which creates it (contract-summary.md)"
      - "unknown fields must be ignored by any reader — additive-only evolution (contract-summary.md)"
      - "never written to directly by anything outside this CLI's own commands (contract-summary.md)"
    sub_objects:
      engine:
        - name: ref
          type: string
          required: true
          constraints: installed engine's commit SHA
        - name: version
          type: string
          required: true
          constraints: display/compare version
        - name: sha256
          type: string
          required: true
          constraints: tarball hash verified at install time
        - name: harness
          type: string
          required: true
          constraints: "e.g. \"cursor\", \"claude-code\" — which harness this install targets"
        - name: installed_at
          type: string (ISO-8601 timestamp)
          required: true
      plugin (one array element):
        - name: name
          type: string
          required: true
        - name: ref
          type: string
          required: true
        - name: version
          type: string
          required: true
        - name: sha256
          type: string
          required: true
        - name: composed_at
          type: string (ISO-8601 timestamp)
          required: true
        - name: engine_version_at_compose
          type: string
          required: true
    relationships: []

  - name: Channel
    description: >
      The central declaration this CLI reads to learn the target engine
      version, plugin set, and migration boundaries. Owned externally —
      this CLI treats it as read-only input, fetched by ChannelClient
      from a git repo or static URL per project config
      (contract-summary.md Contract 1).
    identifier: channel name/URL (external identity, not stored as a field)
    attributes:
      - name: schema
        type: integer
        required: true
        default: 1
        constraints: version marker; current = 1 (v0.1 §2.1)
      - name: channel
        type: string
        required: true
        constraints: "e.g. \"stable\""
      - name: engine
        type: object
        required: true
        constraints: "nested — see engine sub-object below; [desc] not expanded in domain-design-questions.md, unlike the Lockfile's engine shape"
      - name: migration_boundaries
        type: array<object>
        required: true
        defaults: "[]"
        constraints: "each element — see migration_boundary sub-object below; [desc]"
      - name: plugins
        type: array<object>
        required: true
        defaults: "[]"
        constraints: "each element — see plugin sub-object below"
      - name: settings_overlay
        type: object
        required: false
        constraints: opaque overlay, passed through without interpretation
      - name: mcp_overlay
        type: object
        required: false
        constraints: opaque overlay, passed through without interpretation
    entity_constraints:
      - "a sha256 mismatch on any fetched tarball is a hard failure — never silently retried (v0.1 §5.1, contract-summary.md)"
      - "an unrecognized schema value is surfaced to the human, never guessed at (contract-summary.md)"
      - "read-only from this codebase's perspective — this CLI never writes a Channel file"
    sub_objects:
      engine:
        - name: ref
          type: string
          required: true
          constraints: "commit SHA — tags mostly absent in upstream releases (assumption carried from EngineInstaller/ChannelClient behaviour text, not a stored-artifact citation)"
        - name: version
          type: string
          required: true
        - name: tag
          type: string | null
          required: false
        - name: sha256
          type: string
          required: true
      migration_boundary (one array element):
        - name: before
          type: string
          required: true
          constraints: version boundary this rule applies below
        - name: action
          type: "\"reject\" | \"manual\" | \"none\""
          required: true
        - name: note
          type: string
          required: false
          constraints: single-boundary note
        - name: notes
          type: array<string>
          required: false
          constraints: multi-line notes, used for manual boundaries
      plugin (one array element):
        - name: name
          type: string
          required: true
        - name: repo
          type: string
          required: true
        - name: ref
          type: string
          required: true
          constraints: commit SHA
        - name: version
          type: string
          required: true
        - name: sha256
          type: string
          required: true
    relationships: []
```

## Entity Set Summary

`Lockfile` and `Channel` are the only two entities in this system, and
neither references the other by ID. Instead, `VersionGate` and
`DriftDetector` read fields from both (via `LockfileStore` and
`ChannelClient` respectively) and compare them — `Lockfile.engine_origin`
against `Channel.migration_boundaries`, `Lockfile.pin` overriding
`Channel.engine.ref` resolution, and `Lockfile.plugins[]` against
`Channel.plugins[]` element-by-element for drift. This mirrors Domain
Design's own framing: comparing "what is" (drift) and deciding "may this
proceed" (the gate) are behaviours layered on top of two independently
owned, unrelated entities — not a foreign-key relationship.
