# LLM Chess Arena — Plano de Implementação do MVP

## 1. Objetivo

Construir uma arena de xadrez local em que humanos, agentes e futuramente engines
ocupem os mesmos assentos e usem o mesmo protocolo. O servidor é a única autoridade:
mantém a posição, valida identidade, turno e jogadas, calcula o resultado e publica o
estado canônico.

O MVP suporta:

- Humano vs humano, humano vs agente e agente vs agente.
- Criação e entrada em sessões por um ID curto.
- Escolha de brancas, pretas ou atribuição automática entre assentos livres.
- Espectadores sem ocupar assentos.
- Início manual pelo controlador da sessão.
- Tabuleiro, histórico, estado dos participantes e resultado em tempo real.
- Todas as regras e condições de término fornecidas pelo `chess.js`.
- Random, Ollama, Codex e Claude Players com memória estratégica curta.
- Sessões somente em memória. Reiniciar o servidor apaga as sessões.

Persistência, relógio de xadrez, matchmaking, deploy, autenticação de usuários e MCP
ficam fora do MVP.

## 2. Decisões fechadas

- Node.js e TypeScript.
- npm workspaces, pois é o gerenciador disponível no ambiente do projeto.
- `apps/server`: servidor Node independente com HTTP e WebSocket.
- `apps/web`: React e Vite.
- `apps/player-cli`: CLI para Random, Ollama, Codex e Claude.
- `packages/core`: contratos genéricos para jogos por turno.
- `packages/chess`: implementação de xadrez e wrapper exclusivo do `chess.js`.
- `packages/protocol`: tipos e schemas Zod usados em runtime.
- `packages/player-sdk`: cliente WebSocket reutilizável por agentes.
- Estado em memória e uma instância de servidor no MVP.

O servidor não fica dentro do Next.js. Essa separação evita vincular sessões e
WebSockets ao ciclo de vida de um frontend ou ambiente serverless.

## 3. Estrutura

```text
llm-chess-arena/
├── apps/
│   ├── server/src/
│   ├── web/src/
│   └── player-cli/src/
├── packages/
│   ├── core/src/
│   ├── protocol/src/
│   └── player-sdk/src/
├── package.json
└── tsconfig.json
```

## 4. Modelo de domínio

### Sessão e partida

Uma sessão é a sala e existe antes da partida. Uma partida é criada quando o
controlador inicia a sessão.

```ts
type SessionStatus = "waiting" | "ready" | "playing" | "finished"

interface GameSession {
  id: string
  gameType: string
  revision: number
  status: SessionStatus
  controllerToken: string
  white?: Participant
  black?: Participant
  game?: ChessGame
}
```

`ready` é derivado: os dois assentos estão ocupados, conectados e prontos. Os estados
da sessão seguem somente estas transições:

```text
waiting -> ready -> playing -> finished
    ^         |
    └─────────┘  se um participante desconectar antes do início
```

### Participantes, conexões e papéis

```ts
type ParticipantType = "human" | "agent" | "engine"
type ConnectionRole = "player" | "spectator"
type Color = "white" | "black"

interface Participant {
  id: string
  name: string
  type: ParticipantType
  color: Color
  connected: boolean
  ready: boolean
  activity: "idle" | "thinking" | "decided"
}
```

Uma conexão `spectator` recebe snapshots e eventos, mas não ocupa um assento nem pode
jogar. O navegador pode ser espectador de Random vs Random. O controlador é uma
capacidade da sessão, não um terceiro jogador.

## 5. Identidade e autoridade

`POST /api/sessions` devolve:

```json
{
  "sessionId": "K7P4QX",
  "controllerToken": "opaque-random-token"
}
```

O token permite iniciar a partida. Ele não aparece em snapshots, logs ou eventos.
Cada participante recebe no primeiro join um `resumeToken`. Reconexão usa esse token;
nome e assento nunca são usados como credencial.

O servidor associa a conexão ao participante. `move.play` não aceita `playerId`; logo,
um cliente não pode jogar em nome de outro participante.

## 6. HTTP API

```text
POST /api/sessions
GET  /api/sessions/:sessionId
POST /api/sessions/:sessionId/start
GET  /health
```

O endpoint `start` exige `Authorization: Bearer <controllerToken>` e só aceita sessões
`ready`. Todos os endpoints validam entrada e retornam códigos de erro estáveis.

## 7. Protocolo WebSocket

Todas as mensagens são validadas em runtime pelo pacote `protocol`. Campos externos
têm limites de tamanho; IDs e casas do tabuleiro têm formatos explícitos.

### Client events

```ts
type ClientEvent =
  | ConnectionJoinEvent
  | PlayerReadyEvent
  | PlayerStatusEvent
  | MovePlayEvent
  | GameResignEvent
```

Primeiro acesso como jogador:

```json
{
  "type": "connection.join",
  "sessionId": "K7P4QX",
  "role": "player",
  "name": "Qwen 14B",
  "participantType": "agent",
  "requestedColor": "black"
}
```

Espectador:

```json
{
  "type": "connection.join",
  "sessionId": "K7P4QX",
  "role": "spectator"
}
```

Reconexão:

```json
{
  "type": "connection.join",
  "sessionId": "K7P4QX",
  "role": "player",
  "resumeToken": "opaque-random-token"
}
```

Jogada:

```json
{
  "type": "move.play",
  "requestId": "m-unique-id",
  "expectedPly": 12,
  "from": "e7",
  "to": "e8",
  "promotion": "q"
}
```

`requestId` torna retry identificável e `expectedPly` rejeita mensagens atrasadas ou
duplicadas. O processamento de comandos é serializado por sessão.

### Server events

```ts
type ServerEvent =
  | ConnectionAcceptedEvent
  | SessionSnapshotEvent
  | GameStartedEvent
  | TurnStartedEvent
  | MoveMadeEvent
  | MoveInvalidEvent
  | GameFinishedEvent
  | ErrorEvent
```

Após qualquer join e alteração relevante, o servidor envia um snapshot completo:

```ts
interface SessionSnapshotEvent {
  type: "session.snapshot"
  revision: number
  session: {
    id: string
    status: SessionStatus
    white: PublicParticipant | null
    black: PublicParticipant | null
  }
  game?: {
    id: string
    fen: string
    turn: Color
    ply: number
    moves: Move[]
    status: "playing" | "finished"
    result?: GameResult
  }
}
```

`turn.started` é enviado ao participante ativo e contém FEN, ply, última jogada e
jogadas legais em UCI. A FEN inicial é sempre a FEN real devolvida pelo `chess.js`.

Erros usam códigos estáveis, por exemplo `SESSION_NOT_FOUND`, `SEAT_OCCUPIED`,
`NOT_YOUR_TURN`, `STALE_PLY`, `ILLEGAL_MOVE` e `UNAUTHORIZED`.

## 8. Game Core e Chess Adapter

`packages/core` não conhece xadrez, FEN, tabuleiro ou número de jogadores. Ele define
os contratos genéricos `GameDefinition` e `TurnBasedGame` para assentos, ações, estado
público, visão privada, histórico e resultado.

Somente `packages/chess` importa `chess.js` e implementa o contrato genérico.

```ts
class ChessGame {
  playMove(command: MoveCommand): MoveResult
  getFen(): string
  getTurn(): Color
  getLegalMoves(): LegalMove[]
  getHistory(): Move[]
  isGameOver(): boolean
  getResult(): GameResult | undefined
}
```

A classificação do resultado tem precedência determinística:

1. `checkmate`
2. `stalemate`
3. `threefold-repetition`
4. `insufficient-material`
5. `fifty-move-rule`
6. `draw`
7. `resignation`

O projeto fixa a versão do `chess.js` no lockfile e testa a semântica usada.

## 9. Player SDK e agentes

```ts
const player = new PlayerClient({
  server: "ws://localhost:3001",
  sessionId: "K7P4QX",
  name: "Qwen 14B",
  type: "agent",
  color: "black"
})

player.onTurn(async context => ({ from: "e7", to: "e5" }))
await player.connect()
```

O SDK envia `player.ready`, publica atividade e mantém o contexto do turno. O Random
Player escolhe uma jogada legal. Os players Ollama, Codex e Claude:

- Usa saída JSON e valida a resposta.
- Aceita somente uma jogada presente em `legalMoves`.
- Faz no máximo duas tentativas de correção.
- Tem timeout configurável.
- Usa uma jogada aleatória legal como fallback, evitando congelar a partida.
- Mantém apenas uma memória estratégica curta e privada.

Codex usa `codex exec` efêmero, sandbox somente leitura e `--output-schema`. Claude
usa `claude -p`, `--safe-mode`, ferramentas desabilitadas, sessão não persistida e
`--json-schema`. Ambos reutilizam a autenticação das respectivas CLIs e aceitam
`--model` opcional.

## 10. Interface web

A interface permite:

- Criar uma sessão como humano ou espectador.
- Entrar por ID como humano ou espectador.
- Solicitar brancas ou pretas, ou receber automaticamente um assento livre.
- Ver conexão, prontidão e atividade de cada participante.
- Iniciar a sessão quando possuir o `controllerToken`.
- Jogar por drag and drop, incluindo escolha de promoção.
- Observar partidas, histórico, turno e resultado.
- Reconectar usando o `resumeToken` salvo localmente.
- Compartilhar um link para outro humano e consultar comandos de conexão dos agentes.

O frontend nunca aplica uma jogada definitivamente antes da confirmação do servidor.

## 11. Falhas e desconexões

- Antes do início, desconexão torna a sessão `waiting`.
- Durante a partida, o assento permanece reservado para reconexão.
- O MVP não encerra automaticamente por desconexão; o controlador pode reiniciar o
  servidor ou o jogador pode reconectar.
- Agentes possuem timeout próprio e fallback.
- Um jogador pode enviar `game.resign`; o adversário vence.
- Payload inválido encerra apenas aquela mensagem e gera `error`, sem derrubar o
  processo.

## 12. Testes obrigatórios

### Core

- Jogadas válidas e inválidas.
- Xeque, xeque-mate, roque, en passant e promoção.
- Afogamento, repetição, material insuficiente e regra dos cinquenta lances.
- Histórico, FEN, turno e resultado.

### Sessão e serviço

- Criação, assentos, espectador e conflito de assento.
- Somente o controller inicia e somente quando `ready`.
- Identidade derivada da conexão.
- Jogador errado, ply desatualizado e jogada duplicada.
- Reconexão por token.
- Bloqueio de jogadas após o fim e abandono.

### Protocolo e integração

- Rejeição de todos os payloads inválidos relevantes.
- Dois Random Players concluem uma partida headless com limite de plies/tempo no teste.
- Navegador recebe snapshot suficiente para entrar no meio de uma partida.

## 13. Ordem de implementação

1. Bootstrap do monorepo, lint, typecheck e testes.
2. Game Core genérico, protocol schemas e Chess Adapter.
3. SessionManager, GameService, HTTP e WebSocket.
4. Player SDK e Random Player.
5. Teste headless Random vs Random.
6. Interface como espectadora.
7. Interação humana e promoção.
8. Ollama, Codex e Claude Players com validação, timeout e fallback.
9. Memória estratégica e estados de atividade.

## 14. Próximas fases fora do MVP

1. Persistir sessões em andamento e partidas finalizadas. Implementado após o MVP
   com Durable Objects SQLite e índice D1.
2. Publicar frontend e servidor em infraestrutura gratuita compatível com WebSocket.
   Implementado após o MVP em `chess.filipenos.com` com Cloudflare Workers Static
   Assets, Durable Objects e D1.
3. Adicionar outros jogos usando o core genérico.
4. Criar rankings separados por jogo e modalidade a partir das partidas finalizadas,
   com vitórias, derrotas, empates e rating. Identidade estável e metadados congelados
   por partida foram implementados para players CLI; falta definir elegibilidade,
   calcular o rating e expor agregações por identidade, player, provedor e modelo.
5. Adicionar um player para provedores com API compatível com OpenAI, incluindo
   OpenRouter, e aceitar modelos Nemotron e outras famílias oferecidas pelo provedor.
   Persistir separadamente o provedor, o tipo de player e o identificador exato do
   modelo usado em cada partida. Implementado após o MVP para OpenRouter, com chave
   somente via ambiente, modelo obrigatório e saída estruturada.
6. Permitir retomada de players CLI depois de queda ou reinício do processo. O CLI
   deve persistir o `resumeToken` recebido fora do repositório, indexado por servidor
   e sessão, e reutilizá-lo automaticamente ao executar o mesmo comando. O servidor
   deve continuar exigindo esse token para proteger assentos de partidas iniciadas.
   Implementado após o MVP com arquivos locais de permissão restrita, separados por
   identidade do comando e removidos ao receber o encerramento da partida.
7. Criar um sistema de aparência desacoplado do core e das regras. Permitir combinar
   temas de tabuleiro (madeira, verde torneio, azul, mármore e alto contraste) com
   conjuntos SVG de peças (Staunton, minimalista, moderno e pixel art), sem duplicar
   o componente do tabuleiro. Usar variáveis CSS para cores, coordenadas e destaques;
   oferecer seletor com prévias; garantir nitidez, contraste e responsividade; e
   salvar a preferência no `localStorage`.
8. Adicionar na home um link visível para o repositório público
   `github.com/filipenos/llm-game-arena`, abrindo em nova aba com `noopener` e
   `noreferrer`. Implementado após o MVP.
9. Criar uma integração MCP que traduza ferramentas para o protocolo existente e
   permita a agentes criar, entrar, consultar e jogar partidas, sem introduzir
   dependência de MCP em `packages/core`.

## 15. Definição de pronto

O MVP está pronto quando:

1. `npm install` e `npm run dev` iniciam servidor e web.
2. O navegador cria uma sessão e recebe ID e controle.
3. Humanos ou CLIs ocupam os dois assentos escolhidos.
4. O controlador inicia a partida.
5. Humanos jogam pelo tabuleiro e agentes recebem `turn.started`.
6. Todas as jogadas são validadas no servidor.
7. Espectadores acompanham snapshots, histórico, estados e resultado.
8. Random vs Random e Humano vs Random funcionam ponta a ponta; os adapters Ollama,
   Codex e Claude funcionam quando suas respectivas ferramentas estão autenticadas.
9. `npm test`, `npm run lint`, `npm run typecheck` e `npm run build` passam.
