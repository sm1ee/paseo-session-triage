import { DaemonClient, type WebSocketLike } from "@getpaseo/client/internal/daemon-client";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

// The 0.11/0.12 plugin SDK exposes workspace titles but not agent names. Reuse
// one authenticated local connection for names; never spawn a CLI per rename.
export class TitleWriter {
  private connection: Promise<DaemonClient> | null = null;
  private stopped = false;
  constructor(private readonly home = process.env.PASEO_HOME || join(homedir(), ".paseo")) {}
  private async open(): Promise<DaemonClient> {
    const lock = JSON.parse(await readFile(join(this.home, "paseo.pid"), "utf8"));
    if (typeof lock.serverId !== "string" || typeof lock.listen !== "string") throw new Error("Local daemon identity unavailable");
    const socketPath = lock.listen.startsWith("/") || lock.listen.startsWith("unix://") ? lock.listen.replace(/^unix:\/\//, "") : undefined;
    if (socketPath && (!socketPath.startsWith("/") || socketPath.includes("\0"))) throw new Error("Invalid local socket");
    const url = new URL(socketPath ? "ws://localhost/ws" : `ws://${lock.listen}/ws`);
    if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
    if (url.hostname === "[::]") url.hostname = "[::1]";
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/ws" || url.search || url.hash) throw new Error("Title updates require this daemon's local connection");
    const driver = new DaemonClient({ url: url.href, clientId: `session-triage-titles-${randomUUID()}`, clientType: "cli", appVersion: "0.11.4",
      reconnect: { enabled: false }, connectTimeoutMs: 5000, logger: { debug() {}, info() {}, warn() {}, error() {} },
      localCredential: async () => {
        const current = JSON.parse(await readFile(join(this.home, "paseo.pid"), "utf8"));
        if (current.serverId !== lock.serverId || current.pid !== lock.pid || current.startedAt !== lock.startedAt) throw new Error("Local daemon changed");
        const value = (await readFile(join(this.home, "local-credential"), "utf8")).trim();
        if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("Local daemon credential unavailable");
        return value;
      },
      webSocketFactory: (target, options) => new WebSocket(target, options?.protocols, { headers: options?.headers,
        ...(socketPath ? { createConnection: () => connect({ path: socketPath }) } : {}) }) as unknown as WebSocketLike,
    });
    try {
      await driver.connect();
      if (this.stopped || driver.getLastServerInfoMessage()?.serverId !== lock.serverId) throw new Error("Local daemon identity changed");
      return driver;
    } catch (error) { await driver.close(); throw error; }
  }
  async rename(id: string, title: string): Promise<void> {
    if (this.stopped) return;
    const pending = this.connection ??= this.open();
    try {
      const driver = await pending;
      if (this.stopped) return;
      if (driver.getConnectionState().status !== "connected") throw new Error("Local title connection disconnected");
      await driver.updateAgent(id, { name: title });
    } catch (error) {
      if (this.connection === pending) this.connection = null;
      void pending.then((driver) => driver.close(), () => {});
      throw error;
    }
  }
  async client(): Promise<DaemonClient> {
    if (this.stopped) throw new Error("Title updates stopped.");
    const pending = this.connection ??= this.open();
    try {
      const driver = await pending;
      if (this.stopped || driver.getConnectionState().status !== "connected") throw new Error("Local title connection disconnected");
      return driver;
    } catch (error) {
      if (this.connection === pending) this.connection = null;
      void pending.then(driver => driver.close(), () => {});
      throw error;
    }
  }
  async close(): Promise<void> {
    this.stopped = true;
    const pending = this.connection; this.connection = null;
    if (pending) await pending.then((driver) => driver.close(), () => {});
  }
}
