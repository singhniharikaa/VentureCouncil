/**
 * "Why this verdict" - the written explanation for the brand.
 *
 * The decision is made by fixed rules; this card only explains it. The headline
 * is built in code from that decision, and the model is told the decision is
 * final, so the text can never overturn it. The footer says which kind of
 * author wrote the paragraph, because "an AI wrote this" and "this was
 * assembled from the findings" deserve different amounts of trust.
 */
import type { Narrative, Recommendation } from '../types'

const ACCENT: Record<Recommendation, string> = {
  accept: 'var(--color-accept)',
  negotiate: 'var(--color-negotiate)',
  reject: 'var(--color-reject)',
}

export function ExplanationCard({
  narrative,
  decision,
}: {
  narrative: Narrative
  decision: Recommendation
}) {
  return (
    <section
      className="card relative overflow-hidden p-6 pl-7"
      aria-label="Why this verdict"
    >
      <span
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: ACCENT[decision] }}
        aria-hidden="true"
      />
      <div className="eyebrow">Why this verdict</div>
      <h3 className="mt-2 text-lg font-bold tracking-tight">{narrative.headline}</h3>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink">{narrative.explanation}</p>

      {narrative.next_steps.length > 0 && (
        <div className="mt-5">
          <div className="eyebrow">What to do next</div>
          <ul className="mt-2 space-y-1.5">
            {narrative.next_steps.map((s) => (
              <li key={s} className="flex gap-2.5 text-sm text-ink-soft">
                <span
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: ACCENT[decision] }}
                />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-5 border-t border-line pt-3 text-[11px] text-ink-faint">
        {narrative.source === 'ai' ? (
          <>
            Written by AI <span className="mono">({narrative.model})</span> to explain the result.
            The decision itself was made by fixed rules, not by this text.
          </>
        ) : (
          <>
            Assembled from the five findings, with no AI. The decision was made by fixed rules.
          </>
        )}
      </p>
    </section>
  )
}
