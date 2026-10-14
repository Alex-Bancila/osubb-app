/**
 * A stand-in for the Supabase client's reads that answers like PostgREST
 * does with `max_rows = 500` (supabase/config.toml, the same on staging and
 * production): at most 500 rows a request, and not a word about the rest.
 *
 * A source holds what the server would answer a read, already filtered and
 * ordered; the fake records every builder call and answers `.range(from, to)`
 * with that slice. A source may be a function of the request (an `.in` list,
 * say), or answer an `Error`, which comes back as the read's `error`.
 */
export const MAX_ROWS = 500;

export type FakeCall = { method: string; args: unknown[] };
export type FakeRequest = { name: string; args?: unknown; calls: FakeCall[] };
type Answer = readonly unknown[] | Error;
type Source = Answer | ((request: FakeRequest) => Answer);

function argsOf(request: FakeRequest | undefined, method: string): unknown[][] {
  return (request?.calls ?? [])
    .filter((call) => call.method === method)
    .map((call) => call.args);
}

export function createPostgrestFake() {
  const sources = new Map<string, Source>();
  const requests: FakeRequest[] = [];

  function answer(request: FakeRequest) {
    const source = sources.get(request.name) ?? [];
    const rows = typeof source === 'function' ? source(request) : source;
    if (rows instanceof Error) return { data: null, error: rows };
    const [from = 0, to = Infinity] = (argsOf(request, 'range').at(-1) ??
      []) as number[];
    const page = rows.slice(from, Math.min(to + 1, from + MAX_ROWS));
    const single = request.calls.some(
      (call) => call.method === 'single' || call.method === 'maybeSingle',
    );
    return { data: single ? (page[0] ?? null) : page, error: null };
  }

  function builder(request: FakeRequest): unknown {
    requests.push(request);
    const chain: unknown = new Proxy(
      {},
      {
        get(_, property) {
          if (typeof property === 'symbol') return undefined;
          if (property === 'then')
            return (
              resolve: (value: unknown) => unknown,
              reject: (reason: unknown) => unknown,
            ) =>
              Promise.resolve()
                .then(() => answer(request))
                .then(resolve, reject);
          return (...args: unknown[]) => {
            request.calls.push({ method: property, args });
            return chain;
          };
        },
      },
    );
    return chain;
  }

  return {
    client: {
      from: (name: string) => builder({ name, calls: [] }),
      rpc: (name: string, args?: unknown) => builder({ name, args, calls: [] }),
    },
    /** What the server answers every read of this table, view or function. */
    serve(name: string, source: Source) {
      sources.set(name, source);
    },
    /** Every request made to one source, in the order they were made. */
    requestsTo(name: string) {
      return requests.filter((request) => request.name === name);
    },
    /** The arguments of every `method` call one request made. */
    argsOf,
    reset() {
      sources.clear();
      requests.length = 0;
    },
  };
}

/** One fake for a test file: `vi.mock` the client with its `client`. */
export const postgrest = createPostgrestFake();

/**
 * A read that answers `result` however it is chained further: for a test that
 * pins one part of a read and lets the paging (`.order`, `.range`) through.
 */
export function answered(result: unknown): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_, property) {
        if (typeof property === 'symbol') return undefined;
        if (property === 'then')
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject);
        return () => chain;
      },
    },
  );
  return chain;
}
