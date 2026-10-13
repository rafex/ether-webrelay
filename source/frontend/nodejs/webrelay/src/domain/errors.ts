export const RelayErrorCode = {
  InsecureContext: 'insecure-context',
  UnsupportedBrowser: 'unsupported-browser',
  InvalidSettings: 'invalid-settings',
  CaptureDenied: 'capture-denied',
  NoSources: 'no-sources',
  CodecUnsupported: 'codec-unsupported',
  EncoderFailure: 'encoder-failure',
  Protocol: 'protocol',
  BridgeRejected: 'bridge-rejected',
  HandshakeTimeout: 'handshake-timeout',
  ReconnectExhausted: 'reconnect-exhausted',
} as const;

export type RelayErrorCode = (typeof RelayErrorCode)[keyof typeof RelayErrorCode];

export class RelayError extends Error {
  override readonly name = 'RelayError';

  constructor(
    readonly code: RelayErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class ProtocolError extends RelayError {
  constructor(message: string) {
    super(RelayErrorCode.Protocol, message);
  }
}
