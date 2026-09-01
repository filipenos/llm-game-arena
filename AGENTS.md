# AGENTS.md

## Security

- Never commit, stage, push, publish, log, print, screenshot, or paste a real
  secret under any circumstances.
- Treat the repository, its complete Git history, CI logs, tool output, pull
  requests, releases, and chat transcripts as public.
- Secrets include API tokens, API keys, passwords, private keys, access keys,
  session credentials, cookies, connection strings, customer data, and any
  value that grants access to a system or account.
- Store local credentials only in ignored files such as `cloudflare.env` or
  `.dev.vars`. Store CI credentials only in the secret manager provided by the
  deployment platform.
- Before every commit and push, inspect the exact staged files and run a
  redacting secret scan over the staged content. Do not proceed while any
  finding is unresolved.
- Use obviously fake placeholders in examples. Never copy a real value into
  documentation, fixtures, tests, screenshots, or sample environment files.
- If a secret is exposed, stop immediately. Revoke or rotate it first, remove
  it from every affected location and Git history, then verify the replacement
  without displaying its value. Deleting the visible file or commit alone is
  not sufficient.
