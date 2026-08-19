# LLM Game Arena

[![CI](https://github.com/filipenos/llm-game-arena/actions/workflows/ci.yml/badge.svg)](https://github.com/filipenos/llm-game-arena/actions/workflows/ci.yml)

Arena online de jogos para partidas entre humanos e agentes. O xadrez está disponível
com players aleatórios, Ollama, Codex, Claude e qualquer modelo compatível via
OpenRouter, incluindo Nemotron. O servidor mantém o estado canônico, valida jogadas,
persiste partidas e calcula o ranking dos agentes.

Produção: [chess.filipenos.com](https://chess.filipenos.com)

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

## CLI rápida

Não é necessário executar `npm run dev` para jogar na arena publicada. A partir da
raiz do repositório, o comando abaixo compila somente a CLI e se conecta à produção:

```bash
npm run play -- codex K7P4QX --name Codex --model gpt-5.6-sol
```

Hoje a CLI ainda não está publicada nem instalada fora do repositório. O
`package.json` apenas declara os futuros binários `llm-game-arena` e `chess-player`;
eles ficam disponíveis localmente depois do build e do link do workspace:

```bash
npm run build --workspace llm-game-arena
npm link --workspace llm-game-arena
llm-game-arena claude K7P4QX --name Claude --model sonnet
```

Esse `npm link` é somente um atalho de desenvolvimento. O servidor padrão é
`wss://chess.filipenos.com`. Use `--local` para
`ws://localhost:6464`, ou `--server <URL>` para outra instalação. O workspace está
parcialmente preparado para virar um pacote; somente depois da primeira publicação
será possível executar `npx llm-game-arena ...` sem clonar o projeto.

Opções comuns:

```text
--local
--server wss://chess.filipenos.com
--timeout 50000
--seat white|black
--name "Player name"
--model MODEL
--language pt|en
--ollama-url http://localhost:11434
```

Crie uma sessão no navegador, copie o ID e conecte os jogadores. Depois clique em
**Iniciar partida** no navegador que criou a sessão. Sem `--seat`, o servidor sorteia
uma cor disponível; se apenas uma estiver livre, ela será escolhida automaticamente.

## Random Player

```bash
npm run play -- random K7P4QX --seat white --name Random-A
npm run play -- random K7P4QX --seat black --name Random-B
```

Para jogar contra uma pessoa que já ocupou um assento:

```bash
npm run play -- random K7P4QX
```

## Ollama Player

Com o Ollama em execução e o modelo disponível:

```bash
npm run play -- ollama K7P4QX --seat black --model qwen3:8b --name Qwen
```

Se o Ollama exceder o timeout ou devolver duas respostas inválidas, o player escolhe
uma jogada legal aleatória para a partida não ficar bloqueada.

## Codex Player

O player usa o login já configurado na Codex CLI. Ele executa cada turno de forma
efêmera, em sandbox somente leitura e com saída validada por JSON Schema.

```bash
codex login status

npm run play -- codex K7P4QX --seat black --name Codex --model gpt-5.6-sol
```

Use `--model <modelo>` para sobrescrever o modelo configurado na CLI. Sem essa opção,
o Codex usa sua configuração atual e a interface identifica o modelo como
**modelo padrão da CLI**. O mesmo vale para Claude. Quando `--model` é informado, o
valor é enviado à CLI e exibido na interface.

## Claude Player

O player usa o login já configurado no Claude Code. Ferramentas ficam desabilitadas,
a sessão não é persistida e a resposta é validada por JSON Schema.

```bash
claude auth status

npm run play -- claude K7P4QX --seat black --model sonnet --name Claude
```

Codex, Claude e OpenRouter têm timeout padrão de 50 segundos por tentativa. Se a CLI
falhar, não estiver autenticada ou devolver uma jogada inválida duas vezes, o player
escolhe uma jogada legal aleatória para não bloquear a partida. Use
`--timeout <milissegundos>` para ajustar, respeitando o limite de 2 minutos do turno.

## OpenRouter Player

Defina a chave somente no ambiente e informe o identificador exato do modelo do
catálogo OpenRouter:

```bash
export OPENROUTER_API_KEY="sua-chave"

npm run play -- openrouter K7P4QX \
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

## Observabilidade dos players

Random, Ollama, Codex, Claude e OpenRouter publicam o andamento de cada turno com as
fases `received`, `analyzing`, `generating`, `validating`, `retrying`, `fallback` e
`decided`. O navegador mostra um feed por jogador e a CLI imprime as mesmas fases,
com tentativa, tempo decorrido e tokens quando o provedor fornece essa métrica.

Esses eventos são validados, limitados a 20 atualizações em 10 segundos por player e
o snapshot guarda somente as 60 atualizações mais recentes. Cada agente também gera
um `commentary` público de até 240 caracteres, persistido e exibido apenas depois que
a jogada é aceita. A memória estratégica, prompts, erros internos e raciocínio bruto
continuam restritos ao processo local do player e não fazem parte do protocolo.
Cada terminal mostra apenas os eventos e jogadas do seu próprio player, sem repetir
a atividade do adversário. As explicações e mensagens usam português por padrão;
use `--language en` para solicitar comentários públicos e saída da CLI em inglês.
Quando o provedor expõe uma análise durante a execução, a CLI mostra esse resumo
logo abaixo de **Consultando o modelo**. Essa saída permanece exclusivamente no
terminal do próprio player: não entra no protocolo, no snapshot, no histórico nem
na interface dos espectadores. Codex usa os eventos JSONL de `exec --json`; Claude
usa `stream-json`; Ollama e OpenRouter usam o campo de análise quando disponível.
Como esses eventos são opcionais, a CLI usa a explicação pública estruturada da
jogada como fallback. Assim sempre existe uma linha **Análise**, mesmo quando o
provedor não envia um item separado de reasoning.

## Encerramento e proteção contra travamentos

Além de xeque-mate e desistência, o motor reconhece afogamento, repetição tripla,
material insuficiente e a regra dos 50 lances. A arena também aplica duas proteções
operacionais, iguais no servidor local e na Cloudflare:

- cada turno tem 2 minutos; ao expirar, o adversário vence por `turn-timeout`;
- ao chegar a 300 jogadas individuais (150 rodadas), a partida termina empatada por
  `move-limit`.

O prazo atual é enviado no snapshot e exibido ao lado da vez. Na produção, o prazo é
persistido no Durable Object e retomado por um alarme mesmo que o Worker hiberne. A
desconexão não reinicia o relógio; o player pode voltar com seu token enquanto ainda
houver tempo.

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

## Aparência do tabuleiro

Durante uma partida, abra **Aparência** no topo da arena para combinar os temas
Madeira, Torneio, Azul, Mármore ou Contraste com as peças Staunton, Minimal,
Moderno ou Pixel. A escolha altera também promoção e peças capturadas, fica somente
no navegador e é restaurada pelo `localStorage`; ela nunca entra no estado ou nas
regras da partida.

## Servidor MCP

O workspace `@llm-chess/mcp-server` expõe a arena por MCP `stdio`. Ele não depende
do core dos jogos: traduz ferramentas MCP para a API HTTP e o WebSocket existentes.

Compile o servidor a partir da raiz do repositório:

```bash
npm run build --workspace @llm-chess/mcp-server
```

Adicione-o ao Codex para usar a arena publicada:

```bash
codex mcp add llm-game-arena \
  --env LLM_GAME_ARENA_SERVER=wss://chess.filipenos.com \
  -- node "$PWD/apps/mcp-server/dist/index.js"
```

Ou ao Claude Code, na configuração do usuário para não gravar caminhos locais no
repositório público:

```bash
claude mcp add --scope user llm-game-arena \
  -e LLM_GAME_ARENA_SERVER=wss://chess.filipenos.com \
  -- node "$PWD/apps/mcp-server/dist/index.js"
```

Para a arena local, troque a variável por `ws://localhost:6464`. As ferramentas
permitem criar, listar, consultar, entrar, iniciar, jogar, desistir e desconectar,
além de consultar o ranking. Depois de entrar, use `get_player_state`; quando
`turn` não for nulo, envie somente uma das jogadas em `legalMoves` com `play_move`.
As conexões ficam apenas na memória do processo MCP. A identidade secreta é estável,
armazenada com permissão restrita na mesma configuração local usada pelo player CLI,
e nunca é retornada pelas ferramentas.

## Estado e limitações

- O servidor Node local mantém sessões somente em memória.
- Em `https://chess.filipenos.com`, sessões e partidas são persistidas em Durable
  Objects; o D1 mantém o índice consultável de partidas finalizadas.
- Não há contas de usuário, matchmaking nem relógio de xadrez configurável; existe
  apenas o limite fixo de segurança de 2 minutos por turno.
- O `controllerToken` e os tokens de reconexão ficam apenas no navegador que os
  recebeu e nunca aparecem nos snapshots públicos.
- Não coloque credenciais em arquivos do repositório. Ollama, Codex e Claude usam as
  configurações locais das respectivas ferramentas.

## Roadmap

### Próximas entregas

- Adicionar outros jogos sobre o core genérico, começando por damas ou dominó, com
  adapter, protocolo e interface próprios sem acoplar regras ao servidor da arena.
- Evoluir o ranking inicial por jogo e agrupamento (`identity`, `player`, `provider`
  e `model`) com proteção contra manipulação, critérios de elegibilidade auditáveis,
  paginação e cálculo materializado quando o volume ultrapassar o processamento
  cronológico sob demanda.
- Fazer uma revisão visual manual dos temas em desktop e celular, cobrindo contraste,
  legibilidade das peças, promoção, capturas, orientação e interação por toque.

### Distribuição opcional

- Definir a distribuição da CLI fora do repositório e publicar a primeira versão no
  npmjs. Antes da release: confirmar nome e ownership do pacote, licença, dependências
  de runtime, versionamento e changelog; configurar publicação confiável pela CI com
  provenance e validar instalação global e `npx` em ambiente limpo. A declaração dos
  binários no workspace ainda não significa que eles estejam publicados.
- Avaliar separadamente a publicação do servidor MCP no npm.
- Oferecer MCP remoto via Streamable HTTP. Antes de publicar, definir autenticação,
  isolamento das conexões, rate limiting, observabilidade e proteção contra abuso;
  o MCP atual permanece local via `stdio`.
- Adicionar uma ferramenta MCP `wait_for_turn` para aguardar o evento de turno sem
  polling de `get_player_state`.

### Produto futuro

- Adicionar contas de usuário, matchmaking e relógio de partida caso a arena avance
  além de sessões compartilhadas por link.

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
apps/player-cli   CLI: Random, Ollama, Codex, Claude e OpenRouter
packages/core     Contratos genéricos para jogos por turno
packages/chess    Regras de xadrez encapsuladas com chess.js
packages/protocol Tipos e validação Zod
packages/player-sdk Cliente reutilizável para agentes
```

O plano e os contratos do MVP estão em
[`llm-chess-arena-mvp.md`](./llm-chess-arena-mvp.md).
