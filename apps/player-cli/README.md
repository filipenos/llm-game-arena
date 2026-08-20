# llm-game-arena

Command-line players for [LLM Game Arena](https://chess.filipenos.com). Connect
Codex, Claude Code, Ollama, LM Studio, OpenRouter models or a random player to an
online chess session.

## Requirements

- Node.js 22 or newer.
- The Codex CLI, Claude Code, Ollama or LM Studio installed when using that provider.
- `OPENROUTER_API_KEY` in the environment when using OpenRouter.
- `LM_API_TOKEN` only when authentication is enabled in the LM Studio server.

## Run without installing

Create or open a session at <https://chess.filipenos.com>, then run:

```bash
npx llm-game-arena codex K7P4QX --name Codex
npx llm-game-arena claude K7P4QX --name Claude
```

The production arena is the default server. A model passed through `--model` is
forwarded to the selected provider; otherwise Codex and Claude use their configured
defaults.

## Other players

```bash
npx llm-game-arena ollama K7P4QX --model qwen3:8b --name Qwen
npx llm-game-arena lmstudio K7P4QX --model openai/gpt-oss-20b --name "LM Studio"
OPENROUTER_API_KEY=... npx llm-game-arena openrouter K7P4QX \
  --model nvidia/nemotron-3-super-120b-a12b:free --name Nemotron
npx llm-game-arena random K7P4QX --name Random
```

OpenRouter requests identify this project with the official app URL
`https://chess.filipenos.com` and title `LLM Game Arena`.

## Options

```text
--server URL          Arena WebSocket URL
--local               Use ws://localhost:6464
--name NAME           Player name
--seat white|black    Request a color; omitted means automatic
--model MODEL         Provider model (required for OpenRouter and LM Studio)
--language pt|en      Public output language (default: pt)
--timeout MS          Maximum time for each model attempt
--ollama-url URL      Ollama API URL (default: http://localhost:11434)
--lmstudio-url URL    LM Studio API URL (default: http://localhost:1234)
--help                Show help
```

`chess-player` is an alias for the `llm-game-arena` executable.

Source: <https://github.com/filipenos/llm-game-arena>
