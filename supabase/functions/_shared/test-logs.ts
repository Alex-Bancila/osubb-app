// Test helper: runs `fn` with console.error captured, so a test can assert a
// detail went to the function log while the response body stays generic
// (security pass L4). The real console.error is always put back.

export async function capturingErrors<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; logged: string }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(
      args.map((arg) =>
        typeof arg === "string" ? arg : Deno.inspect(arg, { depth: 5 })
      ).join(" "),
    );
  };
  try {
    const result = await fn();
    return { result, logged: lines.join("\n") };
  } finally {
    console.error = original;
  }
}
