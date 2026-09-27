import type { ImageSettings, ProductSpec } from '@/lib/relief/products';
import type { Built, WorkerRequest, WorkerResponse } from './pipeline.worker';

export type { Built };

export interface BuildInput {
  spec: ProductSpec;
  img: ImageSettings;
  art: Float32Array;
  cols: number;
  rows: number;
  cell: number;
}

type Waiter = { resolve: (r: WorkerResponse) => void };
type Unsent = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;

/**
 * Main-thread handle on the pipeline worker.
 *
 * Builds coalesce: while one is running, newer requests replace each other in
 * a single slot, so dragging a slider costs one build per worker cycle rather
 * than a queue of stale ones. Only the latest result is delivered.
 */
export class Pipeline {
  private worker: Worker;
  private seq = 0;
  private waiters = new Map<number, Waiter>();
  private busy = false;
  private next: BuildInput | null = null;

  constructor(
    private onBuilt: (b: Built) => void,
    private onError: (message: string) => void,
    private onBusy: (busy: boolean) => void,
  ) {
    this.worker = new Worker(new URL('./pipeline.worker.ts', import.meta.url));
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const w = this.waiters.get(e.data.id);
      if (w) {
        this.waiters.delete(e.data.id);
        w.resolve(e.data);
      }
    };
    this.worker.onerror = (e) => this.onError(e.message || 'The 3D builder stopped unexpectedly.');
  }

  private send(req: Unsent, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiters.set(id, { resolve });
      this.worker.postMessage({ ...req, id } as WorkerRequest, transfer);
    });
  }

  build(input: BuildInput) {
    if (this.busy) {
      this.next = input;
      return;
    }
    this.busy = true;
    this.onBusy(true);
    void this.send({ type: 'build', ...input }, [input.art.buffer]).then((res) => {
      if (res.type === 'built') {
        if (!this.next) this.onBuilt(res);
      } else if (res.type === 'error') {
        this.onError(res.message);
      }
      this.busy = false;
      const queued = this.next;
      this.next = null;
      if (queued) this.build(queued);
      else this.onBusy(false);
    });
  }

  /** Writes the mesh currently on screen. */
  async export(format: '3mf' | 'stl', title: string, description: string): Promise<ArrayBuffer> {
    const res = await this.send({ type: 'export', format, title, description });
    if (res.type === 'exported') return res.bytes;
    throw new Error(res.type === 'error' ? res.message : 'Export failed.');
  }

  dispose() {
    this.worker.terminate();
    this.waiters.clear();
  }
}
