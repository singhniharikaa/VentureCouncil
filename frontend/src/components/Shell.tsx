import { NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ArrowCircle } from './ui'
import { useEngine } from '../lib/api'

const NAV = [
  { to: '/', label: 'Dashboard', icon: GridIcon, end: true },
  { to: '/deal-room', label: 'Deal Room', icon: DealIcon },
  { to: '/traces', label: 'Agent Traces', icon: TraceIcon },
  { to: '/audit', label: 'Audit Logs', icon: LogIcon },
  { to: '/creators', label: 'Creators', icon: VaultIcon },
]

/**
 * States where evaluation actually happens. This used to be a hardcoded
 * "runs locally / no deal data leaves this machine" note — which stopped
 * being true the moment the Python engine was wired in, since deal and
 * creator details are sent to the LLM provider. Claiming otherwise in the
 * chrome of the app would be a straightforward falsehood, so it now reports
 * the live state.
 */
function EngineFootnote() {
  const engine = useEngine()
  if (engine.status === 'live') {
    return (
      <div className="mt-auto px-1 text-[11px] leading-relaxed text-ink-faint">
        Engine: <span className="text-ink-soft">{engine.health.provider}</span>
        <br />
        Deal details are sent to the model provider.
      </div>
    )
  }
  return (
    <div className="mt-auto px-1 text-[11px] leading-relaxed text-ink-faint">
      {engine.status === 'checking' ? 'Locating engine…' : 'Offline — local scoring only.'}
      <br />
      {engine.status === 'offline' && 'No model in use; no data leaves this machine.'}
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-line bg-paper px-5 py-6 lg:flex">
        <div className="mb-8 flex items-center gap-3 px-1">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-white">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 12V6M6 12V3M10 12V8M14 12V5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <div>
            <div className="text-sm font-bold tracking-tight">VENTURECOUNCIL</div>
            <div className="text-[10px] uppercase tracking-widest text-ink-faint">AI Deal Evaluation</div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/evaluate')}
          className="mb-8 inline-flex items-center justify-between gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink/85"
        >
          New Evaluation
          <ArrowCircle />
        </button>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition ${
                  isActive
                    ? 'border border-line-strong bg-surface font-semibold text-ink'
                    : 'border border-transparent text-ink-soft hover:text-ink'
                }`
              }
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>

        <EngineFootnote />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-line bg-paper/85 px-6 py-4 backdrop-blur lg:px-10">
          <div className="text-sm font-bold tracking-tight lg:hidden">VENTURECOUNCIL</div>
          <div className="relative ml-auto hidden w-full max-w-md md:block">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              placeholder="Search evaluations…"
              className="w-full rounded-full border border-line bg-surface py-2.5 pl-10 pr-4 text-sm outline-none transition placeholder:text-ink-faint focus:border-ink"
            />
          </div>
          <div className="ml-auto flex items-center gap-3 md:ml-0">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-xs font-semibold">
              NS
            </span>
          </div>
        </header>

        <main className="flex-1 px-6 py-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  )
}

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function DealIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 5.5 8 2l6 3.5-6 3.5-6-3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="m2 10.5 6 3.5 6-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function TraceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12.5" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12.5" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.2 7.2 10.8 4.6M5.2 8.8l5.6 2.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function LogIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2h6l2.5 2.5V14H4V2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6 7h4M6 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function VaultIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="6.5" width="11" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 6.5V4.8a2.5 2.5 0 0 1 5 0v1.7" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}
