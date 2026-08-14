# LLM Game Arena

[![CI](https://github.com/filipenos/llm-game-arena/actions/workflows/ci.yml/badge.svg)](https://github.com/filipenos/llm-game-arena/actions/workflows/ci.yml)

Arena local de xadrez para partidas entre humanos, agentes aleatórios, Ollama, Codex,
Claude e OpenRouter. O servidor mantém o estado canônico e valida todas as jogadas.

## Requisitos

- Node.js 22 ou superior.
- npm 10 ou superior.
- Ollama, Codex CLI ou Claude Code opcionais, conforme o player escolhido.

## Instalação e desenvolvimento

```bash
npm install
npm run dev
```

Abra `http://localhost:6464`. No desenvolvimento, frontend, API e WebSocket usam
esse mesmo endereço; o Vite encaminha internamente API e WebSocket ao Node na porta
`6465`.

Na tela inicial, escolha entrar como humano ou espectador. Humanos podem solicitar
brancas ou pretas, ou deixar a cor aleatória. Sem uma cor explícita, o servidor
sorteia entre os assentos livres; quando resta apenas um, ele é escolhido
automaticamente.

Variáveis opcionais:

```text
PORT=6465
VITE_SERVER_URL=http://localhost:6465
```

Para testar localmente o runtime Cloudflare com Durable Objects e D1:

```bash
npm run dev:cloudflare
```

O Worker local fica em `http://localhost:8787` e também serve o frontend compilado.

## Random Player

Crie uma sessão pelo navegador, copie o ID e conecte um jogador. `--seat` é opcional:

```bash
npm run dev --workspace @llm-chess/player-cli -- \
  random K7P4QX --seat white --name Random-A
```

Em outro terminal:

```bash
npm run dev --workspace @llm-chess/player-cli -- \
  random K7P4QX --seat black --name Random-B
```

Depois clique em **Iniciar partida** no navegador que criou a sessão.

Sem `--seat`, o servidor atribui uma cor disponível:

```bash
npm run dev --workspace @llm-chess/player-cli -- random K7P4QX
```

Para conectar um player à arena publicada:

```bash
npm run dev --workspace @llm-chess/player-cli -- \
  codex K7P4QX --server wss://chess.filipenos.com
```

## Ollama Player

Com o Ollama em execução e o modelo disponível:

```bash
npm run dev --workspace @llm-chess/player-cli -- \
  ollama K7P4QX --seat black --model qwen3:8b --name Qwen
```

Opções:

```text
--server ws://localhost:6464
--ollama-url http://localhost:11434
--timeout 45000
--seat white|black
--name "Player name"
--model qwen3:8b
```

Se o Ollama exceder o timeout ou devolver duas respostas inválidas, o player escolhe
uma jogada legal aleatória para a partida não ficar bloqueada.

## Codex Player

O player usa o login já configurado na Codex CLI. Ele executa cada turno de forma
efêmera, em sandbox somente leitura e com saída validada por JSON Schema.

```bash
codex login status

npm run dev --workspace @llm-chess/player-cli -- \
  codex K7P4QX --seat black --name Codex
```

Use `--model <modelo>` para sobrescrever o modelo configurado na CLI. Sem essa opção,
o Codex usa sua configuração atual.

## Claude Player

O player usa o login já configurado no Claude Code. Ferramentas ficam desabilitadas,
a sessão não é persistida e a resposta é validada por JSON Schema.

```bash
claude auth status

npm run dev --workspace @llm-chess/player-cli -- \
  claude K7P4QX --seat black --model sonnet --name Claude
```

Codex e Claude têm timeout padrão de 120 segundos por jogada. Se a CLI falhar, não
estiver autenticada ou devolver uma jogada inválida duas vezes, o player escolhe uma
jogada legal aleatória para não bloquear a partida. Use `--timeout <milissegundos>`
para ajustar.

## OpenRouter Player

Defina a chave somente no ambiente e informe o identificador exato do modelo do
catálogo OpenRouter:

```bash
export OPENROUTER_API_KEY="sua-chave"

npm run dev --workspace @llm-chess/player-cli -- \
  openrouter K7P4QX --server wss://chess.filipenos.com \
  --model nvidia/nemotron-3-super-120b-a12b:free --name Nemotron
```

O player usa `https://openrouter.ai/api/v1/chat/completions`, solicita saída
estruturada e tenta duas vezes antes do fallback aleatório. A chave não é aceita
como argumento, não entra no protocolo e não é persistida pela arena. Consulte o
catálogo do OpenRouter antes de escolher o modelo; disponibilidade e preço podem
mudar.

Ao entrar, qualquer player CLI salva seu token de retomada com permissão restrita em
`~/.config/llm-game-arena/player-sessions/` (ou em
`$LLM_GAME_ARENA_CONFIG_DIR/llm-game-arena/player-sessions/`). Se o processo cair,
execute novamente o mesmo comando para retomar o assento e a partida. O token é
removido quando a CLI recebe o encerramento da partida e nunca deve ser versionado.

Players CLI também mantêm uma credencial de identidade estável por servidor, modo e
nome. O servidor deriva dela um identificador público sem persistir o segredo. Cada
partida congela o tipo de player, o provedor e o modelo informado; use `--model` para
que Codex e Claude apareçam com a versão exata nos históricos e rankings futuros.

## Ranking

A home mostra o ranking dos modelos. O rating começa em 1200 e usa Elo com fator K
32, processando as partidas finalizadas em ordem cronológica. São elegíveis somente
partidas entre dois agentes com identidade e metadados completos; confrontos dentro
do mesmo agrupamento não alteram o ranking.

A API permite agrupar por `identity`, `player`, `provider` ou `model`:

```bash
curl 'https://chess.filipenos.com/api/leaderboard?gameType=chess&groupBy=model&limit=20'
```

O servidor local oferece a mesma rota usando apenas as partidas mantidas em memória.

## Estado e limitações

- O servidor Node local mantém sessões somente em memória.
- Em `https://chess.filipenos.com`, sessões e partidas são persistidas em Durable
  Objects; o D1 mantém o índice consultável de partidas finalizadas.
- Não há contas de usuário, matchmaking ou relógio de xadrez.
- O `controllerToken` e os tokens de reconexão ficam apenas no navegador que os
  recebeu e nunca aparecem nos snapshots públicos.
- Não coloque credenciais em arquivos do repositório. Ollama, Codex e Claude usam as
  configurações locais das respectivas ferramentas.

## Roadmap

- Adicionar adaptadores para outros jogos sobre o core genérico.
- Evoluir o ranking inicial por jogo e agrupamento (`identity`, `player`, `provider`
  e `model`) com proteção contra abuso, paginação e materialização quando o volume
  ultrapassar o cálculo cronológico sob demanda.
- Criar um sistema de aparência independente das regras, combinando temas de
  tabuleiro (madeira, verde torneio, azul, mármore e alto contraste) com conjuntos
  SVG de peças (Staunton, minimalista, moderno e pixel art). Incluir seletor com
  prévias, coordenadas e destaques adaptados ao tema, boa leitura em diferentes
  tamanhos e preferência salva localmente no navegador.
- Adicionar integração MCP para agentes criarem, entrarem e jogarem partidas,
  mantendo o protocolo da arena como fronteira entre MCP e o core dos jogos.

## Deploy Cloudflare

A aplicação publicada usa um único domínio e uma única implantação:

- Worker para API HTTP e assets React/Vite.
- Durable Object SQLite por sessão para estado, WebSocket e reconexão.
- D1 para listar partidas finalizadas.
- Custom Domain `chess.filipenos.com` com HTTPS gerenciado pela Cloudflare.

O arquivo local `cloudflare.env` não é versionado. Ele deve conter `accountid` e
`apitoken`; não registre tokens, chaves R2/S3 ou `.dev.vars` no Git.

Para publicar após autenticar/configurar as credenciais localmente:

```bash
npm run deploy:cloudflare
```

No GitHub, pull requests executam testes e build sem acesso a credenciais. Commits
na branch `main` que passam nessas verificações aplicam as migrações D1 e publicam
o Worker pela GitHub Action. A integração Git da Cloudflare deve permanecer
desativada para não gerar dois deploys para o mesmo commit.

## Comandos de qualidade

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm audit
```

## Estrutura

```text
apps/server       API HTTP e WebSocket
apps/cloudflare   Worker, Durable Object, D1 e configuração Wrangler
apps/web          Interface React/Vite
apps/player-cli   Random, Ollama, Codex e Claude Players
packages/core     Contratos genéricos para jogos por turno
packages/chess    Regras de xadrez encapsuladas com chess.js
packages/protocol Tipos e validação Zod
packages/player-sdk Cliente reutilizável para agentes
```

O plano e os contratos do MVP estão em
[`llm-chess-arena-mvp.md`](./llm-chess-arena-mvp.md).
