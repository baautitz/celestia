const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"] as const;
const CHANNEL = "celestia-activity";
const CHECK_EVERY_MS = 1_000;
/** Atividade local avisada às outras abas no máximo uma vez por segundo. */
const BROADCAST_EVERY_MS = 1_000;

export interface IdleLockOptions {
  idleSeconds: number;
  /** Chamado uma vez quando a ociosidade passa do limite. */
  onIdle: () => void;
  /** Requisição em andamento adia o aviso até terminar. */
  isBusy?: () => boolean;
  /** Relógio em ms (injetável em testes). */
  now?: () => number;
}

/**
 * Mede a ociosidade do usuário: só ação dele (mouse, teclado, toque, rolagem) conta; polling e requisições
 * automáticas não. A atividade numa aba vale para as outras, que compartilham a mesma sessão.
 */
export class IdleLock {
  private lastActivity: number;
  private lastBroadcast = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private readonly now: () => number;
  private readonly onActivity = () => {
    const at = this.now();
    this.lastActivity = at;
    if (at - this.lastBroadcast >= BROADCAST_EVERY_MS) {
      this.lastBroadcast = at;
      this.channel?.postMessage("activity");
    }
  };

  constructor(private readonly options: IdleLockOptions) {
    this.now = options.now ?? Date.now;
    this.lastActivity = this.now();
  }

  start(): void {
    this.lastActivity = this.now();
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, this.onActivity, { passive: true });
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = () => {
        this.lastActivity = this.now();
      };
    }
    this.timer = setInterval(() => {
      if (this.now() - this.lastActivity < this.options.idleSeconds * 1000) return;
      if (this.options.isBusy?.()) return;
      this.stop();
      this.options.onIdle();
    }, CHECK_EVERY_MS);
  }

  stop(): void {
    for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, this.onActivity);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.channel?.close();
    this.channel = null;
  }
}
