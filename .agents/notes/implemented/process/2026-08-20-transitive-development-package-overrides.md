# Agent Note: Transitive development package overrides preserve the runtime dependency graph

Status: implemented

English | [中文](2026-08-20-transitive-development-package-overrides.zh.md)

## Problem

The ignored development-package configuration originally accepted only packages declared directly by the DSH CLI. That worked for an unpublished plugin whose runtime API matched the public dependency closure, but it could not test a plugin and an unpublished SDK or native platform package together. Replacing only the plugin produced a mixed runtime: the current browser and Host bundle loaded while Node resolved the older public SDK and addon.

Treating every configured archive as a top-level CLI package would hide that mismatch, but it would also invent resolver paths that published consumers do not have. Local installer provenance also assumed every override lived at top-level `node_modules`, so it could not identify a real transitive installation.

## Decision

`.dev-package-overrides.json` contains one or more packed direct CLI dependencies and may also contain packed transitive dependencies. The applicator extracts and validates every archive before changing the CLI resolver, then computes reachability from the configured direct roots through each local manifest's `dependencies`, `optionalDependencies`, and `peerDependencies`. A configuration with no direct root or an unreachable archive fails before Electron starts.

Each local package receives a dependency overlay. A configured local archive wins over a public package of the same name; all other dependencies continue to resolve from the direct package's lockfile-derived public closure and the CLI workspace. Only configured direct dependencies are linked into the CLI `node_modules`. A transitive local package is linked only from its selected reachable parent's overlay, so runtime resolution follows the package graph that a published install uses.

Local installer staging materializes the same graph from shallowest package to deepest package without copying temporary overlay directories. Runtime provenance schema version 2 records every direct and transitive archive's SHA-256, version, resolver-relative package path, and installed-directory digest. Artifact verification reads that path instead of assuming a top-level package.

## Alternatives considered

**Override only the direct plugin and reuse every public transitive package.** Rejected because a plugin can compile against an unpublished SDK API while Electron silently loads an older public SDK. A successful window launch would not prove the new Host operations can run.

**Mount every configured archive in the CLI's top-level `node_modules`.** Rejected because it changes Node resolution and can make a local test pass through a package location that no published consumer receives.

**Commit workspace links or tarball paths to the manifest and lockfile.** Rejected because those paths are machine-specific and would contaminate normal development, release packaging, and dependency provenance. The override remains ignored and explicit.

## Consequences

Local integration can now prove one coherent unpublished plugin, SDK, and native addon without publishing or changing tracked dependency metadata. Invalid or unrelated archives fail closed, and the staged installer records where each archive actually landed.

The configuration must list every unpublished package whose bytes matter to the test. Public dependencies remain authoritative when no matching local archive is configured. A package reachable through several local parents is materialized through the first deterministic breadth-first path from the sorted direct roots; every parent that declares it still resolves to the same extracted local package during development.
