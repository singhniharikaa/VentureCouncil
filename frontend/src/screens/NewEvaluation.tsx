/**
 * New evaluation - choose between one deal and a campaign.
 *
 *   Single deal     one creator, one offer          -> /deal-room
 *   Multiple deals  up to five creators, one budget -> /campaign
 *
 * The choice lives in the URL (?mode=multiple), so Discover and other screens
 * can link straight to the right form, and a refresh keeps you where you were.
 */
import { useSearchParams } from 'react-router-dom'

import { SingleDealForm } from '../components/evaluate/SingleDealForm'
import { MultiDealForm } from '../components/evaluate/MultiDealForm'

type Mode = 'single' | 'multiple'

const MODES: { id: Mode; title: string; blurb: string }[] = [
  { id: 'single', title: 'Single deal', blurb: 'One creator, one offer' },
  { id: 'multiple', title: 'Multiple deals', blurb: 'A campaign: up to 5 creators, one budget' },
]

export function NewEvaluation() {
  const [params, setParams] = useSearchParams()
  const mode: Mode = params.get('mode') === 'multiple' ? 'multiple' : 'single'

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="mb-8">
        <h1 className="display text-4xl lg:text-5xl">
          New
          <br />
          Evaluation
        </h1>

        <div
          role="tablist"
          aria-label="Evaluation type"
          className="mt-6 inline-flex rounded-2xl border border-line bg-surface p-1.5"
        >
          {MODES.map((m) => {
            const active = m.id === mode
            return (
              <button
                key={m.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setParams(m.id === 'single' ? {} : { mode: m.id }, { replace: true })}
                className={`rounded-xl px-5 py-2.5 text-left transition ${
                  active ? 'bg-ink text-on-ink' : 'text-ink-soft hover:text-ink'
                }`}
              >
                <div className="text-sm font-semibold">{m.title}</div>
                <div className={`text-[11px] ${active ? 'opacity-70' : 'text-ink-faint'}`}>{m.blurb}</div>
              </button>
            )
          })}
        </div>
      </div>

      {mode === 'single' ? <SingleDealForm /> : <MultiDealForm />}
    </div>
  )
}
