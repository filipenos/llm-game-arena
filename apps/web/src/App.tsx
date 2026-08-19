import { useEffect, useMemo, useRef, useState } from "react"
import type {
  Color,
  ChessMove,
  LeaderboardResponse,
  Promotion,
  PublicParticipant,
  PlayerProgress,
  ServerEvent,
  SessionSnapshot,
  SessionSummary
} from "@llm-chess/protocol"
import {
  capturedPieces,
  pieceSymbol,
  promotionChoices,
  promotionSymbol
} from "./chess-display.js"
import {
  boardThemes,
  loadAppearance,
  pieceSets,
  saveAppearance,
  type BoardAppearance,
  type BoardTheme,
  type PieceSet
} from "./appearance.js"

const HTTP_SERVER = import.meta.env.VITE_SERVER_URL ?? window.location.origin
const WS_SERVER = HTTP_SERVER.replace(/^http/, "ws")
const SESSION_ID_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/

class SessionRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

async function fetchSessionSnapshot(sessionId: string): Promise<SessionSnapshot> {
  const response = await fetch(`${HTTP_SERVER}/api/sessions/${sessionId}`)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { code?: string; message?: string }
    throw new SessionRequestError(
      body.code ?? "REQUEST_FAILED",
      response.status,
      body.message ?? "Não foi possível carregar a sessão"
    )
  }
  return await response.json() as SessionSnapshot
}

interface RoomOptions {
  sessionId: string
  role: "player" | "spectator"
  name: string
  color?: Color
}

interface JoinForm {
  sessionId: string
  name: string
  role: "player" | "spectator"
  color: Color | "random"
}

const initialJoinForm: JoinForm = {
  sessionId: "",
  name: "Human Player",
  role: "player",
  color: "random"
}

function resumeKey(sessionId: string, color: Color): string {
  return `llm-chess:resume:${sessionId}:${color}`
}

function sessionResumeKey(sessionId: string): string {
  return `llm-chess:resume:${sessionId}`
}

function controllerKey(sessionId: string): string {
  return `llm-chess:controller:${sessionId}`
}

function roomFromLocation(): RoomOptions | undefined {
  const params = new URLSearchParams(window.location.search)
  const sessionId = params.get("session")
  const role = params.get("role")
  const normalizedSessionId = sessionId?.toUpperCase() ?? ""
  if (!SESSION_ID_PATTERN.test(normalizedSessionId) || (role !== "player" && role !== "spectator")) {
    return undefined
  }
  const color = params.get("color")
  return {
    sessionId: normalizedSessionId,
    role,
    name: params.get("name") ?? "Human Player",
    ...(color === "white" || color === "black" ? { color } : {})
  }
}

function saveRoomLocation(room: RoomOptions): void {
  const params = new URLSearchParams({
    session: room.sessionId,
    role: room.role,
    name: room.name,
    ...(room.color ? { color: room.color } : {})
  })
  window.history.replaceState(null, "", `?${params.toString()}`)
}

function playerInviteUrl(sessionId: string): string {
  const url = new URL(window.location.pathname, window.location.origin)
  url.search = new URLSearchParams({
    session: sessionId,
    role: "player",
    name: "Convidado"
  }).toString()
  return url.toString()
}

export function App() {
  const [room, setRoom] = useState<RoomOptions | undefined>(roomFromLocation)
  const [form, setForm] = useState<JoinForm>(initialJoinForm)
  const [snapshot, setSnapshot] = useState<SessionSnapshot>()
  const [participantId, setParticipantId] = useState<string>()
  const [legalMoves, setLegalMoves] = useState<string[]>([])
  const [movePending, setMovePending] = useState(false)
  const [startPending, setStartPending] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState("")
  const [controllerToken, setControllerToken] = useState(
    room ? localStorage.getItem(controllerKey(room.sessionId)) ?? "" : ""
  )
  const socketRef = useRef<WebSocket | undefined>(undefined)
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse>()
  const [appearance, setAppearance] = useState(loadAppearance)

  function updateAppearance(next: BoardAppearance): void {
    setAppearance(next)
    saveAppearance(next)
  }

  useEffect(() => {
    if (room) return
    let stopped = false
    void fetch(`${HTTP_SERVER}/api/sessions?status=finished&limit=6`)
      .then(async response => response.ok
        ? await response.json() as { sessions: SessionSummary[] }
        : { sessions: [] })
      .then(data => {
        if (!stopped) setRecentSessions(data.sessions)
      })
      .catch(() => {
        if (!stopped) setRecentSessions([])
      })
    void fetch(`${HTTP_SERVER}/api/leaderboard?gameType=chess&groupBy=model&limit=5`)
      .then(async response => response.ok
        ? await response.json() as LeaderboardResponse
        : undefined)
      .then(data => {
        if (!stopped) setLeaderboard(data)
      })
      .catch(() => {
        if (!stopped) setLeaderboard(undefined)
      })
    return () => { stopped = true }
  }, [room])

  useEffect(() => {
    if (!room) return
    saveRoomLocation(room)
    setLegalMoves([])
    setMovePending(false)
    setControllerToken(localStorage.getItem(controllerKey(room.sessionId)) ?? "")
    let stopped = false
    let retry: number | undefined

    const connect = () => {
      const socket = new WebSocket(`${WS_SERVER}/ws?session=${room.sessionId}`)
      socketRef.current = socket
      let resumeTokenUsed: string | null = null
      let retriedWithoutToken = false

      const sendPlayerJoin = (resumeToken: string | null) => {
        socket.send(JSON.stringify({
          type: "connection.join",
          sessionId: room.sessionId,
          role: "player",
          ...(resumeToken
            ? { resumeToken }
            : {
                name: room.name,
                participantType: "human",
                ...(room.color ? { requestedColor: room.color } : {})
              })
        }))
      }

      socket.addEventListener("open", () => {
        if (room.role === "spectator") {
          socket.send(JSON.stringify({
            type: "connection.join",
            sessionId: room.sessionId,
            role: "spectator"
          }))
          return
        }
        resumeTokenUsed = localStorage.getItem(sessionResumeKey(room.sessionId))
          ?? (room.color ? localStorage.getItem(resumeKey(room.sessionId, room.color)) : null)
        sendPlayerJoin(resumeTokenUsed)
      })
      socket.addEventListener("message", message => {
        const event = JSON.parse(String(message.data)) as ServerEvent
        if (event.type === "connection.accepted") {
          setConnected(true)
          setError("")
          setParticipantId(event.participantId)
          if (event.color && event.resumeToken) {
            localStorage.setItem(resumeKey(room.sessionId, event.color), event.resumeToken)
            localStorage.setItem(sessionResumeKey(room.sessionId), event.resumeToken)
          }
          if (event.role === "player") {
            socket.send(JSON.stringify({ type: "player.ready" }))
          }
        } else if (event.type === "session.snapshot") {
          setSnapshot(event)
          setMovePending(false)
        } else if (event.type === "player.progress") {
          setSnapshot(current => current?.game ? {
            ...current,
            game: {
              ...current.game,
              progress: [...current.game.progress, event.progress].slice(-60)
            }
          } : current)
        } else if (event.type === "turn.started") {
          setLegalMoves(event.legalMoves)
        } else if (
          event.type === "error"
          && resumeTokenUsed
          && !retriedWithoutToken
          && (event.code === "INVALID_MESSAGE" || event.code === "INVALID_RESUME_TOKEN")
        ) {
          retriedWithoutToken = true
          if (room.color) localStorage.removeItem(resumeKey(room.sessionId, room.color))
          localStorage.removeItem(sessionResumeKey(room.sessionId))
          resumeTokenUsed = null
          sendPlayerJoin(null)
        } else if (event.type === "error" || event.type === "move.invalid") {
          setMovePending(false)
          setError(`${event.code}: ${event.message}`)
        }
      })
      socket.addEventListener("close", () => {
        setConnected(false)
        setMovePending(false)
        if (!stopped) retry = window.setTimeout(connect, 1_500)
      })
      socket.addEventListener("error", () => setError("Não foi possível conectar ao servidor."))
    }

    void fetchSessionSnapshot(room.sessionId)
      .then(initialSnapshot => {
        if (stopped) return
        setSnapshot(initialSnapshot)
        connect()
      })
      .catch(caught => {
        if (stopped) return
        if (caught instanceof SessionRequestError && caught.code === "SESSION_NOT_FOUND") {
          window.history.replaceState(null, "", window.location.pathname)
          setRoom(undefined)
          setSnapshot(undefined)
          setParticipantId(undefined)
          setConnected(false)
          setError("Sessão não encontrada. Ela pode ter expirado após o servidor reiniciar.")
          return
        }
        setError(caught instanceof Error ? caught.message : "Falha ao carregar a sessão")
      })

    return () => {
      stopped = true
      if (retry) window.clearTimeout(retry)
      socketRef.current?.close()
    }
  }, [room])

  async function createSession(): Promise<void> {
    setError("")
    try {
      const response = await fetch(`${HTTP_SERVER}/api/sessions`, { method: "POST" })
      if (!response.ok) throw new Error("Falha ao criar a sessão")
      const data = await response.json() as { sessionId: string; controllerToken: string }
      localStorage.setItem(controllerKey(data.sessionId), data.controllerToken)
      setControllerToken(data.controllerToken)
      setRoom({
        sessionId: data.sessionId,
        role: form.role,
        name: form.name,
        ...(form.role === "player" && form.color !== "random" ? { color: form.color } : {})
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao criar a sessão")
    }
  }

  async function joinSession(): Promise<void> {
    const sessionId = form.sessionId.trim().toUpperCase()
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      setError("O ID da sessão deve ter exatamente 6 caracteres válidos.")
      return
    }
    setError("")
    try {
      await fetchSessionSnapshot(sessionId)
      setRoom({
        sessionId,
        role: form.role,
        name: form.name,
        ...(form.role === "player" && form.color !== "random" ? { color: form.color } : {})
      })
    } catch (caught) {
      if (caught instanceof SessionRequestError && caught.code === "SESSION_NOT_FOUND") {
        setError("Sessão não encontrada. Confira o ID ou crie uma nova partida.")
        return
      }
      setError(caught instanceof Error ? caught.message : "Falha ao procurar a sessão")
    }
  }

  async function startGame(): Promise<void> {
    if (!room || !controllerToken || startPending) return
    setError("")
    setStartPending(true)
    try {
      const response = await fetch(`${HTTP_SERVER}/api/sessions/${room.sessionId}/start`, {
        method: "POST",
        headers: { authorization: `Bearer ${controllerToken}` }
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { code?: string; message?: string }
        setError(`${body.code ?? "ERROR"}: ${body.message ?? "Não foi possível iniciar"}`)
      }
    } catch {
      setError("Falha de conexão ao iniciar a partida. Tente novamente.")
    } finally {
      setStartPending(false)
    }
  }

  function leaveRoom(): void {
    socketRef.current?.close()
    window.history.replaceState(null, "", window.location.pathname)
    setRoom(undefined)
    setSnapshot(undefined)
    setParticipantId(undefined)
    setLegalMoves([])
    setMovePending(false)
    setConnected(false)
    setError("")
  }

  if (!room) {
    return (
      <main className="landing">
        <section className="hero">
          <p className="eyebrow">LOCAL PLAYGROUND</p>
          <h1>LLM Chess Arena</h1>
          <p className="hero-copy">Coloque humanos e agentes no mesmo tabuleiro. O servidor cuida das regras.</p>
          <a
            className="github-link"
            href="https://github.com/filipenos/llm-game-arena"
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver projeto no GitHub <span aria-hidden="true">↗</span>
          </a>
          {leaderboard && <Leaderboard leaderboard={leaderboard} />}
          {recentSessions.length > 0 && <RecentSessions sessions={recentSessions} />}
        </section>
        <section className="entry-card">
          <label>
            Seu nome
            <input value={form.name} maxLength={80} onChange={event => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="spaced-field">
            Entrar como
            <select value={form.role} onChange={event => setForm({ ...form, role: event.target.value as JoinForm["role"] })}>
              <option value="player">Humano</option>
              <option value="spectator">Espectador</option>
            </select>
          </label>
          {form.role === "player" ? (
            <label className="spaced-field">
              Cor
              <select value={form.color} onChange={event => setForm({ ...form, color: event.target.value as JoinForm["color"] })}>
                <option value="random">Aleatória</option>
                <option value="white">Brancas</option>
                <option value="black">Pretas</option>
              </select>
            </label>
          ) : (
            <p className="form-help">
              Você acompanhará a partida sem ocupar um assento. Depois, convide duas pessoas ou conecte LLMs usando o ID da sessão.
            </p>
          )}
          <button className="full create-button" onClick={() => void createSession()}>Nova partida</button>
          <div className="divider"><span>ou entre em uma sala</span></div>
          <label>
            ID da sessão
            <input
              className="session-input"
              value={form.sessionId}
              maxLength={6}
              minLength={6}
              pattern="[A-HJ-NP-Z2-9]{6}"
              placeholder="K7P4QX"
              onChange={event => setForm({ ...form, sessionId: event.target.value.toUpperCase() })}
            />
          </label>
          <button className="secondary full join-button" onClick={() => void joinSession()}>Entrar</button>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    )
  }

  const mine = snapshot
    ? [snapshot.session.white, snapshot.session.black].find(player => player?.id === participantId)
    : undefined
  const moves = snapshot?.game?.moves ?? []
  return (
    <main className="arena-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">SESSION</p>
          <h1>{room.sessionId}</h1>
        </div>
        <div className="topbar-actions">
          <AppearanceControl appearance={appearance} onChange={updateAppearance} />
          <span className={connected ? "connection online" : "connection"}>{connected ? "Conectado" : "Reconectando"}</span>
          <button className="text-button" onClick={leaveRoom}>Sair</button>
        </div>
      </header>

      {error && <p className="error banner">{error}</p>}
      <section className="arena-layout">
        <aside className="players-panel">
          <PlayerCard
            label="PRETAS"
            player={snapshot?.session.black ?? null}
            captures={capturedPieces(moves, "black")}
            pieceSet={appearance.pieces}
            progress={snapshot?.game?.progress.filter(item => item.color === "black") ?? []}
          />
          <div className="versus">VS</div>
          <PlayerCard
            label="BRANCAS"
            player={snapshot?.session.white ?? null}
            captures={capturedPieces(moves, "white")}
            pieceSet={appearance.pieces}
            progress={snapshot?.game?.progress.filter(item => item.color === "white") ?? []}
          />
          {snapshot?.session.status !== "playing" && snapshot?.session.status !== "finished" && (
            <div className="lobby-actions">
              {controllerToken && (
                <button disabled={snapshot?.session.status !== "ready" || startPending} onClick={() => void startGame()}>
                  {startPending ? "Iniciando…" : "Iniciar partida"}
                </button>
              )}
              <InviteHelp sessionId={room.sessionId} />
            </div>
          )}
        </aside>

        <section className="board-panel">
          <GameStatus snapshot={snapshot} mine={mine} error={error} legalMoves={legalMoves} />
          <ChessBoard
            fen={snapshot?.game?.fen}
            orientation={mine?.color ?? "white"}
            theme={appearance.theme}
            pieceSet={appearance.pieces}
            enabled={Boolean(connected && !movePending && mine && snapshot?.game?.status === "playing" && snapshot.game.turn === mine.color)}
            legalMoves={legalMoves}
            lastMove={snapshot?.game?.moves.at(-1)}
            onMove={(from, to, promotion) => {
              if (!snapshot?.game) return
              setError("")
              setMovePending(true)
              socketRef.current?.send(JSON.stringify({
                type: "move.play",
                requestId: crypto.randomUUID(),
                expectedPly: snapshot.game.ply,
                from,
                to,
                ...(promotion ? { promotion } : {})
              }))
            }}
          />
        </section>

        <aside className="history-panel">
          <p className="eyebrow">HISTÓRICO</p>
          <MoveHistory moves={snapshot?.game?.moves ?? []} />
        </aside>
      </section>
    </main>
  )
}

function Leaderboard({ leaderboard }: { leaderboard: LeaderboardResponse }) {
  return (
    <section className="leaderboard" aria-label="Ranking de modelos">
      <p className="eyebrow">RANKING DE MODELOS</p>
      {leaderboard.entries.length === 0 ? (
        <p className="leaderboard-empty">Ainda não há partidas elegíveis entre agentes com modelo informado.</p>
      ) : (
        <ol>
          {leaderboard.entries.map(entry => (
            <li key={entry.key}>
              <span className="leaderboard-rank">{entry.rank}</span>
              <span>
                <b>{entry.label}</b>
                <small>{entry.agent?.provider} · {entry.games} {entry.games === 1 ? "partida" : "partidas"}</small>
              </span>
              <strong>{entry.rating}</strong>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function RecentSessions({ sessions }: { sessions: SessionSummary[] }) {
  return (
    <section className="recent-sessions" aria-label="Partidas recentes">
      <p className="eyebrow">PARTIDAS RECENTES</p>
      <div className="recent-list">
        {sessions.map(session => {
          const winner = session.winner === "white"
            ? session.whiteName
            : session.winner === "black" ? session.blackName : null
          return (
            <article key={session.sessionId}>
              <div>
                <b>{session.whiteName ?? "Brancas"}</b>
                <span> × </span>
                <b>{session.blackName ?? "Pretas"}</b>
              </div>
              <small>
                {winner ? `${winner} venceu` : "Empate"}
                {session.finishReason ? ` · ${session.finishReason}` : ""}
                {` · ${Math.ceil(session.ply / 2)} lances`}
              </small>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function InviteHelp({ sessionId }: { sessionId: string }) {
  const commandPrefix = "npm run play --"
  const serverOption = import.meta.env.DEV ? " --local" : ""
  return (
    <details className="invite-help" open>
      <summary>Convidar pessoas ou LLMs</summary>
      <p>Compartilhe este link. Sem uma cor definida, o servidor sorteia um assento livre:</p>
      <code>{playerInviteUrl(sessionId)}</code>
      <p>Ou conecte um agente pelo terminal:</p>
      <code>{commandPrefix} codex {sessionId}{serverOption}</code>
      <code>{commandPrefix} claude {sessionId}{serverOption}</code>
      <code>{commandPrefix} ollama {sessionId} --model qwen3:8b{serverOption}</code>
      <code>{commandPrefix} random {sessionId}{serverOption}</code>
      <p className="help-note">Use <b>--seat white</b> ou <b>--seat black</b> somente quando quiser exigir uma cor.</p>
    </details>
  )
}

const themeLabels: Record<BoardTheme, string> = {
  wood: "Madeira",
  tournament: "Torneio",
  blue: "Azul",
  marble: "Mármore",
  contrast: "Contraste"
}

const pieceSetLabels: Record<PieceSet, string> = {
  staunton: "Staunton",
  minimal: "Minimal",
  modern: "Moderno",
  pixel: "Pixel"
}

function AppearanceControl({
  appearance,
  onChange
}: {
  appearance: BoardAppearance
  onChange: (appearance: BoardAppearance) => void
}) {
  return (
    <details className="appearance-control">
      <summary>Aparência</summary>
      <div className="appearance-menu">
        <p className="eyebrow">TABULEIRO</p>
        <div className="appearance-options theme-options">
          {boardThemes.map(theme => (
            <button
              className={`appearance-option theme-${theme}`}
              type="button"
              key={theme}
              aria-pressed={appearance.theme === theme}
              onClick={() => onChange({ ...appearance, theme })}
            >
              <span className="theme-preview" aria-hidden="true"><i /><i /></span>
              <small>{themeLabels[theme]}</small>
            </button>
          ))}
        </div>
        <p className="eyebrow piece-heading">PEÇAS</p>
        <div className="appearance-options piece-options">
          {pieceSets.map(pieces => (
            <button
              className={`appearance-option piece-set-${pieces}`}
              type="button"
              key={pieces}
              aria-pressed={appearance.pieces === pieces}
              onClick={() => onChange({ ...appearance, pieces })}
            >
              <span className="piece-preview" aria-hidden="true">{pieceSymbol("N", pieces)}</span>
              <small>{pieceSetLabels[pieces]}</small>
            </button>
          ))}
        </div>
      </div>
    </details>
  )
}

function PlayerCard({
  label,
  player,
  captures,
  pieceSet,
  progress
}: {
  label: string
  player: PublicParticipant | null
  captures: string[]
  pieceSet: PieceSet
  progress: PlayerProgress[]
}) {
  return (
    <article className="player-card">
      <p className="eyebrow">{label}</p>
      <h2>{player?.name ?? "Aguardando…"}</h2>
      <p className="player-meta">
        <span className={player?.connected ? "dot online" : "dot"} />
        {player ? `${player.connected ? "Conectado" : "Desconectado"} · ${player.activity}` : "Assento livre"}
      </p>
      {player?.agent && (
        <p className="agent-meta">
          {player.agent.player} · {player.agent.provider}
          {player.agent.model === "default"
            ? " · modelo padrão da CLI"
            : player.agent.model ? ` · ${player.agent.model}` : " · modelo não informado"}
          {player.tokenUsage.totalTokens > 0 && (
            <span
              className="token-usage"
              title={`${player.tokenUsage.inputTokens} entrada · ${player.tokenUsage.outputTokens} saída · ${player.tokenUsage.totalTokens} total`}
            >
              {` · ${compactTokens(player.tokenUsage.totalTokens)} tok · ↓${compactTokens(player.tokenUsage.inputTokens)} ↑${compactTokens(player.tokenUsage.outputTokens)}`}
            </span>
          )}
        </p>
      )}
      {player?.agent && progress.length > 0 && (
        <ol className="player-progress" aria-label={`Atividade de ${player.name}`}>
          {progress.slice(-4).map((item, index) => (
            <li key={`${item.ply}-${item.at}-${index}`}>
              <span>{progressPhaseLabel(item.phase)}</span>
              <small>{progressMetrics(item)}</small>
            </li>
          ))}
        </ol>
      )}
      <div className="captured-pieces" aria-label={`Peças capturadas por ${player?.name ?? label}`}>
        <span>Capturadas</span>
        {captures.length > 0 ? (
          <div>{captures.map((piece, index) => (
            <i
              className={`piece-set-${pieceSet} piece-${piece === piece.toUpperCase() ? "white" : "black"}`}
              key={`${piece}-${index}`}
              title="Peça capturada"
            >
              {pieceSymbol(piece, pieceSet)}
            </i>
          ))}</div>
        ) : <small>Nenhuma</small>}
      </div>
    </article>
  )
}

function GameStatus({
  snapshot,
  mine,
  error,
  legalMoves
}: {
  snapshot?: SessionSnapshot
  mine?: PublicParticipant | null
  error: string
  legalMoves: string[]
}) {
  const deadline = snapshot?.game?.turnDeadlineAt
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!deadline || snapshot?.game?.result) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [deadline, snapshot?.game?.result])

  if (!snapshot) {
    return <p className="game-status">{error ? "Estado indisponível" : "Carregando estado…"}</p>
  }
  if (!snapshot.game) return <p className="game-status">Sala {snapshot.session.status}</p>
  if (snapshot.game.result) {
    return (
      <p className="game-status result">
        Fim: {finishReasonLabel(snapshot.game.result.reason)} · {snapshot.game.result.winner ? `${snapshot.game.result.winner === "white" ? "brancas" : "pretas"} venceram` : "empate"}
      </p>
    )
  }
  const remaining = deadline ? ` · ${formatRemainingTime(deadline - now)}` : ""
  const ownTurn = mine?.color === snapshot.game.turn
  if (ownTurn) {
    const lastMove = snapshot.game.moves.at(-1)?.san ?? ""
    const inCheck = /[+#]$/.test(lastMove)
    return (
      <p className={`game-status ${inCheck ? "check" : ""}`}>
        {inCheck ? "Sua vez — xeque" : "Sua vez"}
        {legalMoves.length === 1 ? " · única jogada legal destacada" : ""}
        {remaining}
      </p>
    )
  }
  return <p className="game-status">Vez das {snapshot.game.turn === "white" ? "brancas" : "pretas"}{remaining}</p>
}

function formatRemainingTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function finishReasonLabel(reason: string): string {
  return ({
    checkmate: "xeque-mate",
    stalemate: "afogamento",
    "threefold-repetition": "repetição tripla",
    "insufficient-material": "material insuficiente",
    "fifty-move-rule": "regra dos 50 lances",
    draw: "empate",
    resignation: "desistência",
    "turn-timeout": "tempo esgotado",
    "move-limit": "limite de jogadas"
  } as Record<string, string>)[reason] ?? reason
}

function parseFen(fen?: string): Map<string, string> {
  const board = new Map<string, string>()
  const position = (fen ?? "8/8/8/8/8/8/8/8").split(" ")[0] ?? ""
  position.split("/").forEach((rank, rankIndex) => {
    let file = 0
    for (const token of rank) {
      const empty = Number(token)
      if (Number.isInteger(empty) && empty > 0) file += empty
      else {
        board.set(`${String.fromCharCode(97 + file)}${8 - rankIndex}`, token)
        file += 1
      }
    }
  })
  return board
}

function ChessBoard({
  fen,
  orientation,
  theme,
  pieceSet,
  enabled,
  legalMoves,
  lastMove,
  onMove
}: {
  fen?: string
  orientation: Color
  theme: BoardTheme
  pieceSet: PieceSet
  enabled: boolean
  legalMoves: string[]
  lastMove?: { from: string; to: string }
  onMove: (from: string, to: string, promotion?: Promotion) => void
}) {
  const pieces = useMemo(() => parseFen(fen), [fen])
  const [dragFrom, setDragFrom] = useState<string>()
  const [selectedFrom, setSelectedFrom] = useState<string>()
  const suppressClickAfterDrag = useRef(false)
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: string
    to: string
    color: Color
  }>()
  const legalOrigins = useMemo(
    () => new Set(legalMoves.map(move => move.slice(0, 2))),
    [legalMoves]
  )
  const selectedOrigin = selectedFrom && enabled && legalOrigins.has(selectedFrom)
    ? selectedFrom
    : undefined
  const activeFrom = dragFrom ?? selectedOrigin
  const files = orientation === "white" ? ["a", "b", "c", "d", "e", "f", "g", "h"] : ["h", "g", "f", "e", "d", "c", "b", "a"]
  const ranks = orientation === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]

  function playMove(from: string, to: string): void {
    const movingPiece = pieces.get(from)
    setDragFrom(undefined)
    setSelectedFrom(undefined)
    if (movingPiece?.toLowerCase() === "p" && (to.endsWith("1") || to.endsWith("8"))) {
      setPendingPromotion({
        from,
        to,
        color: movingPiece === movingPiece.toUpperCase() ? "white" : "black"
      })
      return
    }
    onMove(from, to)
  }

  useEffect(() => {
    if (!pendingPromotion) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingPromotion(undefined)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [pendingPromotion])

  return (
    <>
      <div className={`chessboard theme-${theme} piece-set-${pieceSet} ${enabled ? "enabled" : ""}`} aria-label="Tabuleiro de xadrez">
      {ranks.flatMap((rank, rankIndex) => files.map((file, fileIndex) => {
        const square = `${file}${rank}`
        const piece = pieces.get(square)
        const isLight = (rankIndex + fileIndex) % 2 === 0
        const canDrag = Boolean(enabled && piece && legalOrigins.has(square))
        const isLegalTarget = Boolean(
          enabled && activeFrom && legalMoves.some(move => move.startsWith(`${activeFrom}${square}`))
        )
        const isSelected = selectedOrigin === square
        const isLastMoveOrigin = lastMove?.from === square
        const isLastMoveTarget = lastMove?.to === square
        return (
          <div
            className={`square ${isLight ? "light" : "dark"}${isLastMoveOrigin ? " last-move-origin" : ""}${isLastMoveTarget ? " last-move-target" : ""}${canDrag ? " legal-origin" : ""}${isLegalTarget ? " legal-target" : ""}${isSelected ? " selected-origin" : ""}`}
            key={square}
            data-square={square}
            onClick={() => {
              if (suppressClickAfterDrag.current) return
              if (!enabled) {
                setSelectedFrom(undefined)
                return
              }
              if (selectedOrigin && isLegalTarget) {
                playMove(selectedOrigin, square)
                return
              }
              setSelectedFrom(canDrag && selectedFrom !== square ? square : undefined)
            }}
            onDragOver={event => { if (isLegalTarget) event.preventDefault() }}
            onDrop={event => {
              event.preventDefault()
              const from = event.dataTransfer.getData("text/plain")
              const movePrefix = `${from}${square}`
              if (!enabled || !legalMoves.some(move => move.startsWith(movePrefix))) {
                setDragFrom(undefined)
                setSelectedFrom(undefined)
                return
              }
              playMove(from, square)
            }}
          >
            {piece && (
              <span
                className={`piece piece-${piece === piece.toUpperCase() ? "white" : "black"}`}
                draggable={canDrag}
                role="img"
                aria-label={`Peça ${piece === piece.toUpperCase() ? "branca" : "preta"}`}
                onDragStart={event => {
                  suppressClickAfterDrag.current = true
                  event.dataTransfer.effectAllowed = "move"
                  event.dataTransfer.setData("text/plain", square)
                  setDragFrom(square)
                }}
                onDragEnd={() => {
                  setDragFrom(undefined)
                  window.setTimeout(() => { suppressClickAfterDrag.current = false }, 0)
                }}
              >
                {pieceSymbol(piece, pieceSet)}
              </span>
            )}
            {(fileIndex === 0 || rankIndex === 7) && <span className="coordinate">{fileIndex === 0 ? rank : file}</span>}
          </div>
        )
      }))}
      </div>
      {pendingPromotion && (
        <div className="promotion-backdrop" role="presentation">
          <section
            className={`promotion-dialog theme-${theme} piece-set-${pieceSet}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="promotion-title"
          >
            <p className="eyebrow">PROMOÇÃO</p>
            <h2 id="promotion-title">Escolha sua nova peça</h2>
            <div className="promotion-options">
              {promotionChoices.map(choice => (
                <button
                  key={choice.value}
                  type="button"
                  aria-label={`Promover para ${choice.label}`}
                  onClick={() => {
                    onMove(pendingPromotion.from, pendingPromotion.to, choice.value)
                    setPendingPromotion(undefined)
                  }}
                >
                  <span className={`piece-${pendingPromotion.color}`}>
                    {promotionSymbol(choice.piece, pendingPromotion.color, pieceSet)}
                  </span>
                  <small>{choice.label}</small>
                </button>
              ))}
            </div>
            <button
              className="text-button promotion-cancel"
              type="button"
              onClick={() => setPendingPromotion(undefined)}
            >
              Cancelar
            </button>
          </section>
        </div>
      )}
    </>
  )
}

function progressPhaseLabel(phase: PlayerProgress["phase"]): string {
  return ({
    received: "Turno recebido",
    analyzing: "Analisando",
    generating: "Consultando o modelo",
    validating: "Validando jogada",
    retrying: "Tentando novamente",
    fallback: "Usando jogada reserva",
    decided: "Jogada decidida"
  } as Record<PlayerProgress["phase"], string>)[phase]
}

function progressMetrics(progress: PlayerProgress): string {
  return [
    progress.attempt ? `${progress.attempt}ª` : "",
    progress.elapsedMs !== undefined ? formatMilliseconds(progress.elapsedMs) : "",
    progress.durationMs !== undefined ? `prov. ${formatMilliseconds(progress.durationMs)}` : "",
    progress.inputTokens !== undefined ? `↓${compactTokens(progress.inputTokens)}` : "",
    progress.outputTokens !== undefined ? `↑${compactTokens(progress.outputTokens)}` : ""
  ].filter(Boolean).join(" · ")
}

function compactTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${Number((tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0))}k`
  return `${Number((tokens / 1_000_000).toFixed(1))}M`
}

function formatMilliseconds(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${milliseconds}ms`
    : `${Number((milliseconds / 1_000).toFixed(1))}s`
}

function MoveHistory({ moves }: { moves: ChessMove[] }) {
  if (moves.length === 0) return <p className="empty-history">Nenhuma jogada.</p>
  const rows: Array<{ number: number; white: ChessMove; black?: ChessMove }> = []
  for (let index = 0; index < moves.length; index += 2) {
    const white = moves[index]
    if (white) rows.push({ number: index / 2 + 1, white, ...(moves[index + 1] ? { black: moves[index + 1] } : {}) })
  }
  return (
    <ol className="move-list">
      {rows.map(row => (
        <li key={row.number}>
          <span>{row.number}.</span>
          <div><b>{row.white.san}</b>{row.white.commentary && <small>{row.white.commentary}</small>}</div>
          <div><b>{row.black?.san ?? "…"}</b>{row.black?.commentary && <small>{row.black.commentary}</small>}</div>
        </li>
      ))}
    </ol>
  )
}
