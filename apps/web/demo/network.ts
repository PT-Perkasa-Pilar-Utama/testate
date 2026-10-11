/**
 * The demo's network (#demo): every request the SPA makes to the API path is answered by the API
 * running in this page. `fetch` for the calls, an `EventSource` for job progress, and a click
 * handler for the download links. Anything else goes to the network as usual: the page's own
 * assets, under the demo's path.
 */
type Backend = { fetch: (request: Request) => Promise<Response> };

let backend: Backend | null = null;
let prefix = "";

const isApi = (url: URL): boolean =>
  url.origin === location.origin && url.pathname.startsWith(prefix);

async function answer(request: Request): Promise<Response> {
  if (backend === null) throw new Error("the demo's API has not started");
  return backend.fetch(request);
}

/** Server-sent events read off the in-page response, frame by frame. */
class DemoEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = 0;
  readonly url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  private readonly abort = new AbortController();

  constructor(url: string | URL) {
    super();
    this.url = new URL(url, location.href).href;
    void this.run();
  }

  private emit(type: string, data: string, id: string): void {
    const event = new MessageEvent(type, { data, lastEventId: id });
    if (type === "message") this.onmessage?.(event);
    this.dispatchEvent(event);
  }

  private async run(): Promise<void> {
    try {
      const response = await answer(
        new Request(this.url, {
          signal: this.abort.signal,
          headers: { Accept: "text/event-stream" },
        })
      );
      if (!response.ok || response.body === null)
        throw new Error(`events answered ${response.status}`);
      this.readyState = 1;
      this.onopen?.(new Event("open"));
      this.dispatchEvent(new Event("open"));
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffered = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += value;
        const frames = buffered.split("\n\n");
        buffered = frames.pop() ?? "";
        for (const frame of frames) this.frame(frame);
      }
      this.fail();
    } catch {
      if (this.readyState !== 2) this.fail();
    }
  }

  private frame(frame: string): void {
    let type = "message";
    let id = "";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("id:")) id = line.slice(3).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0) this.emit(type, data.join("\n"), id);
  }

  private fail(): void {
    this.readyState = 2;
    const event = new Event("error");
    this.onerror?.(event);
    this.dispatchEvent(event);
  }

  close(): void {
    this.readyState = 2;
    this.abort.abort();
  }
}

/** A download link to the API: fetched in the page, saved through an object URL. */
async function download(anchor: HTMLAnchorElement): Promise<void> {
  const response = await answer(new Request(anchor.href));
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? anchor.download ?? "download";
  const url = URL.createObjectURL(await response.blob());
  const save = document.createElement("a");
  save.href = url;
  save.download = name;
  save.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function installNetwork(api: Backend, apiPrefix: string): void {
  backend = api;
  prefix = apiPrefix;
  const network = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    return isApi(new URL(request.url)) ? answer(request) : network(request);
  };
  // The SPA uses `new EventSource(url)`, `onmessage`, `addEventListener` and `close`.
  Object.assign(globalThis, { EventSource: DemoEventSource });
  document.addEventListener(
    "click",
    (event) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (anchor === null || !isApi(new URL(anchor.href, location.href))) return;
      event.preventDefault();
      void download(anchor);
    },
    true
  );
}
