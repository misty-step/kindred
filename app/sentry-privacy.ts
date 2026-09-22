type UnknownRecord = Record<string, unknown>;

type EventLike = {
  contexts?: Record<string, unknown>;
  request?: {
    method?: string;
    url?: string;
    [key: string]: unknown;
  };
  tags?: Record<string, unknown>;
  [key: string]: unknown;
};

const environments = new Set(["production", "staging", "test"]);
const errorTypes = new Set([
  "AggregateError",
  "DOMException",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);
const eventLevels = new Set(["debug", "info", "warning", "error", "fatal"]);
const mechanismTypes = new Set([
  "generic",
  "onerror",
  "onunhandledrejection",
  "auto.browser.global_handlers.onerror",
  "auto.browser.global_handlers.onunhandledrejection",
]);
const platforms = new Set(["javascript", "node"]);
const runtimes = new Set(["browser", "edge", "server"]);
const spanOperations = new Set([
  "browser",
  "function.nextjs",
  "http.client",
  "http.server",
  "middleware.nextjs",
  "navigation",
  "pageload",
  "resource.css",
  "resource.img",
  "resource.script",
  "ui.action.click",
  "ui.action.submit",
]);
const spanOrigins = new Set([
  "auto.http.nextjs",
  "auto.navigation.browser",
  "auto.pageload.browser",
  "manual",
]);
const spanStatuses = new Set([
  "aborted",
  "already_exists",
  "cancelled",
  "data_loss",
  "deadline_exceeded",
  "failed_precondition",
  "internal_error",
  "invalid_argument",
  "not_found",
  "ok",
  "out_of_range",
  "permission_denied",
  "resource_exhausted",
  "unauthenticated",
  "unavailable",
  "unimplemented",
  "unknown_error",
]);

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function compact(value: UnknownRecord): UnknownRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function exactString(value: unknown, allowed: Set<string>): string | undefined {
  return typeof value === "string" && allowed.has(value) ? value : undefined;
}

function matchingString(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function traceId(value: unknown): string | undefined {
  return matchingString(value, /^[0-9a-f]{32}$/i);
}

function spanId(value: unknown): string | undefined {
  return matchingString(value, /^[0-9a-f]{16}$/i);
}

function safeSymbol(value: unknown): string | undefined {
  return matchingString(
    value,
    /^(?:[A-Za-z_$][A-Za-z0-9_$]*)(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/,
  );
}

function safeRelease(value: unknown): string | undefined {
  return matchingString(value, /^(?:[0-9a-f]{40}|local)$/i);
}

function pathOnly(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = new URL(raw, "https://kindred.invalid");
    const safePath =
      parsed.pathname === "/" ||
      /^\/(?:api\/(?:guest|health)|(?:apple-icon|opengraph-image)\.png|icon\.svg)$/.test(
        parsed.pathname,
      ) ||
      /^\/(?:_next|brand)\//.test(parsed.pathname)
        ? parsed.pathname
        : "/[redacted]";
    return parsed.origin === "https://kindred.invalid"
      ? safePath
      : `${parsed.origin}${safePath}`;
  } catch {
    return undefined;
  }
}

function sourceLocation(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = new URL(raw);
    if (!(
      ["http:", "https:"].includes(parsed.protocol) &&
      /\.[cm]?[jt]sx?$/.test(parsed.pathname)
    )) {
      return undefined;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return /^(?:[A-Za-z0-9_$@.-]+\/)*[A-Za-z0-9_$@.-]+\.[cm]?[jt]sx?$/.test(raw)
      ? raw
      : undefined;
  }
}

function sanitizeMechanism(value: unknown): UnknownRecord | undefined {
  const source = record(value);
  if (!source) return undefined;
  const result = compact({
    type: exactString(source["type"], mechanismTypes),
    handled: bool(source["handled"]),
    synthetic: bool(source["synthetic"]),
    is_exception_group: bool(source["is_exception_group"]),
    exception_id: integer(source["exception_id"]),
    parent_id: integer(source["parent_id"]),
  });
  return Object.keys(result).length === 0 ? undefined : result;
}

function sanitizeFrame(value: unknown): UnknownRecord | undefined {
  const source = record(value);
  if (!source) return undefined;
  const result = compact({
    filename: sourceLocation(source["filename"]),
    abs_path: sourceLocation(source["abs_path"]),
    function: safeSymbol(source["function"]),
    lineno: integer(source["lineno"]),
    colno: integer(source["colno"]),
    in_app: bool(source["in_app"]),
    instruction_addr: matchingString(
      source["instruction_addr"],
      /^0x[0-9a-f]+$/i,
    ),
  });
  return Object.keys(result).length === 0 ? undefined : result;
}

function sanitizeStacktrace(value: unknown): UnknownRecord | undefined {
  const source = record(value);
  if (!source || !Array.isArray(source["frames"])) return undefined;
  const frames = source["frames"]
    .map(sanitizeFrame)
    .filter((frame): frame is UnknownRecord => frame !== undefined);
  return frames.length === 0 ? undefined : { frames };
}

function sanitizeException(value: unknown): UnknownRecord | undefined {
  const source = record(value);
  if (!source || !Array.isArray(source["values"])) return undefined;
  const values = source["values"]
    .map((item) => {
      const exception = record(item);
      if (!exception) return undefined;
      const originalType = exception["type"];
      const type =
        typeof originalType === "string" && errorTypes.has(originalType)
          ? originalType
          : typeof originalType === "string"
            ? "Error"
            : undefined;
      const result = compact({
        type,
        mechanism: sanitizeMechanism(exception["mechanism"]),
        stacktrace: sanitizeStacktrace(exception["stacktrace"]),
      });
      return Object.keys(result).length === 0 ? undefined : result;
    })
    .filter((item): item is UnknownRecord => item !== undefined);
  return values.length === 0 ? undefined : { values };
}

function sanitizeTrace(value: unknown): UnknownRecord | undefined {
  const source = record(value);
  if (!source) return undefined;
  const result = compact({
    trace_id: traceId(source["trace_id"]),
    span_id: spanId(source["span_id"]),
    parent_span_id: spanId(source["parent_span_id"]),
    op: exactString(source["op"], spanOperations),
    status: exactString(source["status"], spanStatuses),
    origin: exactString(source["origin"], spanOrigins),
    sampled: bool(source["sampled"]),
  });
  return Object.keys(result).length === 0 ? undefined : result;
}

function sanitizeSpan(value: unknown): UnknownRecord | undefined {
  const source = record(value);
  if (!source) return undefined;
  const result = compact({
    trace_id: traceId(source["trace_id"]),
    span_id: spanId(source["span_id"]),
    parent_span_id: spanId(source["parent_span_id"]),
    op: exactString(source["op"], spanOperations),
    status: exactString(source["status"], spanStatuses),
    origin: exactString(source["origin"], spanOrigins),
    start_timestamp: finiteNumber(source["start_timestamp"]),
    timestamp: finiteNumber(source["timestamp"]),
  });
  return Object.keys(result).length === 0 ? undefined : result;
}

function sanitizeTags(value: unknown): UnknownRecord | undefined {
  const source = record(value);
  if (!source) return undefined;
  const result = compact({
    environment: exactString(source["environment"], environments),
    release: safeRelease(source["release"]),
    runtime: exactString(source["runtime"], runtimes),
    service: source["service"] === "kindred" ? "kindred" : undefined,
  });
  return Object.keys(result).length === 0 ? undefined : result;
}

/**
 * Build a new Sentry payload from privacy-reviewed diagnostics only.
 * Unknown fields are dropped instead of recursively forwarding future SDK surfaces.
 */
export function redactSentryEvent<T extends EventLike>(event: T): T {
  const trace = sanitizeTrace(event.contexts?.["trace"]);
  const request = event.request
    ? compact({
        method: matchingString(event.request.method, /^[A-Z]{3,10}$/),
        url: pathOnly(event.request.url),
      })
    : undefined;
  const spans = Array.isArray(event["spans"])
    ? event["spans"]
        .map(sanitizeSpan)
        .filter((span): span is UnknownRecord => span !== undefined)
    : undefined;

  return compact({
    event_id: matchingString(event["event_id"], /^[0-9a-f]{32}$/i),
    type: event["type"] === "transaction" ? "transaction" : undefined,
    transaction:
      typeof event["transaction"] === "string" ? "kindred.request" : undefined,
    start_timestamp: finiteNumber(event["start_timestamp"]),
    timestamp: finiteNumber(event["timestamp"]),
    platform: exactString(event["platform"], platforms),
    level: exactString(event["level"], eventLevels),
    environment: exactString(event["environment"], environments),
    release: safeRelease(event["release"]),
    dist: matchingString(event["dist"], /^\d{1,20}$/),
    exception: sanitizeException(event["exception"]),
    contexts: trace ? { trace } : undefined,
    request: request && Object.keys(request).length > 0 ? request : undefined,
    spans: spans && spans.length > 0 ? spans : undefined,
    tags: sanitizeTags(event.tags),
  }) as T;
}
