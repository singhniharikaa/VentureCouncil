import type { ReactNode } from 'react'
import type { Recommendation } from '../types'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`card ${className}`}>{children}</div>
}

export function Eyebrow({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="eyebrow flex items-center gap-2">
      {icon}
      {children}
    </div>
  )
}

export function PillButton({
  children,
  onClick,
  variant = 'solid',
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'solid' | 'outline'
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
}) {
  const base =
    'inline-flex items-center gap-2.5 rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed'
  const styles =
    variant === 'solid'
      ? 'bg-ink text-white hover:bg-ink/85'
      : 'border border-line-strong bg-surface text-ink hover:border-ink'
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  )
}

export function ArrowCircle() {
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full bg-white/20">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

const VERDICT_STYLES: Record<Recommendation, { label: string; cls: string }> = {
  accept: { label: 'Accepted', cls: 'border-accept/30 bg-accept-bg text-accept' },
  negotiate: { label: 'Negotiate', cls: 'border-negotiate/30 bg-negotiate-bg text-negotiate' },
  reject: { label: 'Rejected', cls: 'border-reject/30 bg-reject-bg text-reject' },
}

export function VerdictBadge({
  verdict,
  size = 'sm',
}: {
  verdict: Recommendation
  size?: 'sm' | 'lg'
}) {
  const s = VERDICT_STYLES[verdict]
  const dims = size === 'lg' ? 'px-5 py-2 text-sm' : 'px-3 py-1 text-[11px]'
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border font-semibold uppercase tracking-wider ${dims} ${s.cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  )
}

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string
  children: ReactNode
  hint?: string
  error?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-soft">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 flex items-center gap-1 text-xs text-reject">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M6 3.5v3M6 8.4v.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-faint">{hint}</span>
      ) : null}
    </label>
  )
}

const inputBase =
  'w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-ink'

export function TextInput({
  value,
  onChange,
  placeholder,
  invalid,
  type = 'text',
  prefix,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  invalid?: boolean
  type?: string
  prefix?: string
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
          {prefix}
        </span>
      )}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputBase} ${invalid ? 'border-reject' : 'border-line'} ${prefix ? 'pl-7' : ''}`}
      />
    </div>
  )
}

export function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  invalid,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  invalid?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputBase} ${invalid ? 'border-reject' : 'border-line'} ${!value ? 'text-ink-faint' : ''}`}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o} value={o} className="text-ink">
          {o}
        </option>
      ))}
    </select>
  )
}

export function TogglePill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
        active
          ? 'border-ink bg-ink text-white'
          : 'border-line-strong bg-surface text-ink hover:border-ink'
      }`}
    >
      {children}
    </button>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid place-items-center rounded-[22px] border border-dashed border-line-strong px-6 py-16 text-center">
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-ink-soft">{body}</p>
      </div>
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      <div className="eyebrow mt-1">{label}</div>
    </div>
  )
}
