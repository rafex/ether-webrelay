export interface CloseInfo {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

export interface TransportHandlers {
  onText(text: string): void;
  onClose(info: CloseInfo): void;
}

/** An open, message-oriented, binary-capable connection to the bridge. */
export interface TransportConnection {
  send(data: ArrayBuffer): void;
  /** Bytes queued but not yet handed to the network. */
  readonly bufferedAmount: number;
  close(code?: number, reason?: string): void;
}

/** Driven port: opens connections to the bridge. */
export interface TransportPort {
  /** Resolves once the connection is open; rejects if it cannot be established. */
  connect(url: string, handlers: TransportHandlers): Promise<TransportConnection>;
}
