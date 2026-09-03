# Changelog

Notable changes to Agent Session Bridge are documented here.

## Unreleased

### Added

- Public contribution, support, and security documentation.
- CI and dependency-update automation.
- Security regression coverage for configuration, terminal classification, and workspace path containment.

### Changed

- Remote HTTP binding now requires a strong API token, explicit allowed hosts, and allowed workspace roots.
- Feishu authorization and workspace trust confirmation now fail closed by default.
- Dependency lock data now uses the official npm registry and patched dependency versions.

### Security

- Hardened terminal command classification against shell-composition and write-capable option bypasses.
- Added canonical-path checks to prevent workspace symlink escapes.
- Added bounded JSON request bodies, constant-time token comparison, security headers, and sanitized internal errors.

## 0.1.0 - 2026-04-18

- Initial private preview of the tmux and SQLite session bridge.
