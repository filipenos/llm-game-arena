# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Changed

- Use `games.filipenos.com` as the main arena domain and the default CLI server.
- Present the home page as LLM Game Arena for chess, checkers and tic-tac-toe.
- Keep `chess.filipenos.com` available for existing links and CLI versions.

## 0.3.0 - 20/08/2026

### Added

- LM Studio player through its local OpenAI-compatible Chat Completions API.
- Optional LM Studio authentication through `LM_API_TOKEN`.

### Changed

- OpenRouter requests are explicitly attributed to LLM Game Arena through the
  official app URL and title headers.
- Public command examples use the published `npx llm-game-arena` CLI.

## 0.2.0 - 19/08/2026

### Added

- First public CLI release for Random, Ollama, Codex, Claude and OpenRouter players.
- Automatic player reconnection with locally protected resume tokens.
- Public progress, localized commentary and cumulative token metrics.
- Production connection to `wss://chess.filipenos.com` by default.
