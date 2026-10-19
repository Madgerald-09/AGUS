import type { AgentReply } from "@/lib/financial-agent";
import { FinancialPresentationSchema } from "@/lib/financial-agent/presentation";
const date = (value: string, time = false) =>
  new Date(value).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
export function FinancialResponse({
  reply,
  choose,
}: {
  reply: AgentReply;
  choose: (text: string) => void;
}) {
  const parsed = FinancialPresentationSchema.safeParse(reply.presentation);
  const presentation =
    parsed.success &&
    parsed.data.results.every((r) => reply.citations.includes(r.resultId))
      ? parsed.data
      : null;
  if (!presentation)
    return (
      <div className="agus-prose">
        {reply.text.split(/\n+/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    );
  const sources = new Set(
    presentation.results.flatMap((r) =>
      r.sources.map((s) => `${s.provider}/${s.mode}`),
    ),
  );
  return (
    <>
      {presentation.narration === "factual_fallback" && (
        <p className="agus-fallback">
          AI explanation unavailable · Verified factual summary
        </p>
      )}
      <div className="agus-prose">
        {presentation.explanation.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {presentation.results.map((r) => (
        <section
          className="agus-result"
          key={r.resultId}
          aria-label="Financial result"
        >
          {r.metrics.length > 0 && (
            <dl className="agus-totals" aria-label="Financial totals">
              {r.metrics.map((m) => (
                <div key={m.label}>
                  <dt>{m.label}</dt>
                  <dd>{m.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="agus-scope">{r.scope}</p>
          {r.limits
            .filter(
              (limit) =>
                !presentation.explanation.some((p) => p.includes(limit)),
            )
            .map((limit, i) => (
              <p className="agus-limit" key={i}>
                {limit}
              </p>
            ))}
          {r.records.map((record, i) => (
            <section className="agus-record" key={i}>
              <h3>{record.name}</h3>
              <strong>
                {record.amount} ·{" "}
                {record.direction === "debit" ? "Debit" : "Credit"}
              </strong>
              <p>
                {record.date ? date(record.date) : "Date unavailable"} ·{" "}
                {record.status === "posted"
                  ? "Posted in source records"
                  : `Source status: ${record.status}`}
              </p>
              <p>{record.account}</p>
              {record.choice && (
                <button
                  className="agus-secondary"
                  onClick={() => choose(record.choice!)}
                >
                  Show {record.name} · {record.amount}
                  {record.date ? ` · ${date(record.date)}` : ""}
                </button>
              )}
            </section>
          ))}
        </section>
      ))}
      <details className="agus-sources">
        <summary>
          Sources and calculation · {sources.size}{" "}
          {sources.size === 1 ? "source" : "sources"}
        </summary>
        {presentation.results.map((r) => (
          <section key={r.resultId}>
            <h3>Source snapshot</h3>
            <p>
              {r.sources.map((s) => `${s.provider}/${s.mode}`).join(", ") ||
                "Source unavailable"}
            </p>
            <p>
              As of {date(r.asOf, true)} WAT · Coverage {r.coverage}
            </p>
            <p>Result reference: {r.resultId}</p>
            <pre>{r.originalText}</pre>
          </section>
        ))}
        <h3>Original response</h3>
        <pre>{reply.text}</pre>
      </details>
    </>
  );
}
