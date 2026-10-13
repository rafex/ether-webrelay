const PREFERRED_TYPES = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];

/** Records the composite preview locally (WebM) so it can be saved or transcoded. */
export class LocalRecorder {
  private recorder: MediaRecorder | undefined;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  start(stream: MediaStream): void {
    if (this.recording) return;
    const mimeType = PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start(1_000);
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      return Promise.reject(new Error('Recorder is not running'));
    }
    return new Promise((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(this.chunks, { type: recorder.mimeType || 'video/webm' }));
      recorder.stop();
    });
  }
}
