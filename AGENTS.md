# Codex rules for LPC_528_App

- Do not hardcode IP addresses, tokens, credentials, ports, script paths, or filesystem paths in application code; load them from validated configuration and keep examples in `.env.example` only.
- Do not remove or weaken LPC parsers without tests that preserve the current frame compatibility.
- Put major logic into focused modules under `src/lpc`, `src/scanner`, `src/programs`, `src/splunk`, `src/zebra`, `src/backup`, `src/config`, `src/server`, or `src/shared`.
- Maintain compatibility with known LPC-528 result and stream frame formats, including Telnet/menu noise handling.
- Before changing parser behavior, add or update a unit test that captures the LPC frame being changed.
- Keep secrets out of Git and out of pull request descriptions.
