import { useState, type FormEvent, type ReactNode } from 'react'
import { DEMO, nav, useAuth } from '../auth'
import { documents } from '../mock/library'
import { useStore } from '../store'
import { LowPolyScene } from './LowPolyScene'

const field = 'mt-1 w-full rounded-md border border-rule bg-surface px-3 py-2'

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="grid h-full overflow-y-auto bg-surface lg:grid-cols-[minmax(380px,520px)_1fr]">
      <div className="flex flex-col p-[clamp(20px,4vw,56px)]">
        <button className="inline-flex items-center gap-2 self-start border-0 bg-transparent p-0 text-[20px] font-bold tracking-tight" onClick={() => nav('')}><img src="/litmus-face.svg" alt="" width={28} height={28} />Litmus</button>
        <div className="m-auto w-full max-w-[380px] py-10">{children}</div>
      </div>
      <div className="relative bg-[#eef2f7] max-lg:hidden"><LowPolyScene className="absolute inset-0 h-full w-full" /></div>
    </main>
  )
}

export function Login() {
  const login = useAuth((s) => s.login)
  const [email, setEmail] = useState(DEMO.email)
  const [password, setPassword] = useState(DEMO.password)
  const [error, setError] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (login(email, password)) nav('')
    else setError(`That email or password is wrong. The demo account is ${DEMO.email} with password ${DEMO.password}.`)
  }
  return (
    <Shell>
      <h1 className="m-0 text-[36px] font-bold leading-none tracking-[-0.03em]">Log in</h1>
      <p className="mb-0 mt-3 text-muted">The demo account is filled in for you.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div><label htmlFor="email" className="text-[13px] font-medium">Email</label><input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={field} /></div>
        <div><label htmlFor="pw" className="text-[13px] font-medium">Password</label><input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} /></div>
        {error && <p role="alert" className="m-0 text-[13px] text-refuted">{error}</p>}
        <button type="submit" className="btn btn-primary w-full py-2.5">Log in</button>
      </form>
      <p className="mt-5 text-[14px] text-muted">New here? <button className="border-0 bg-transparent p-0 text-ink underline underline-offset-2" onClick={() => nav('#/signup')}>Get started</button></p>
    </Shell>
  )
}

const steps = ['Create your account', 'Connect your library', 'Pick a research goal']

export function Signup() {
  const { signup } = useAuth()
  const begin = useStore((s) => s.begin)
  const [step, setStep] = useState(0)
  const [name, setName] = useState(DEMO.name)
  const [email, setEmail] = useState(DEMO.email)
  const [password, setPassword] = useState(DEMO.password)
  const [linked, setLinked] = useState<'idle' | 'busy' | 'done'>('idle')
  const [goal, setGoal] = useState('Which training tricks actually help a tiny CIFAR-10 classifier?')
  const highlights = documents.reduce((n, d) => n + d.highlight_count, 0)
  const connect = () => { setLinked('busy'); setTimeout(() => setLinked('done'), 900) }
  return (
    <Shell>
      <p className="m-0 text-[13px] text-muted">Step {step + 1} of {steps.length}</p>
      <h1 className="m-0 mt-1 text-[32px] font-bold leading-none tracking-[-0.03em]">{steps[step]}</h1>
      {step === 0 && (
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && email.includes('@') && password) { signup(name.trim(), email.trim()); setStep(1) } }}>
          <p className="m-0 text-muted">Demo details are filled in. Change them if you like.</p>
          <div><label htmlFor="n" className="text-[13px] font-medium">Name</label><input id="n" value={name} onChange={(e) => setName(e.target.value)} className={field} /></div>
          <div><label htmlFor="e" className="text-[13px] font-medium">Email</label><input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} /></div>
          <div><label htmlFor="p" className="text-[13px] font-medium">Password</label><input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} /></div>
          <button type="submit" className="btn btn-primary w-full py-2.5">Continue</button>
        </form>
      )}
      {step === 1 && (
        <div className="mt-6 space-y-4">
          <p className="m-0 text-muted">Litmus reads the highlights and notes in your Papiers library.</p>
          <ul className="m-0 list-none space-y-1.5 p-0 text-[13.5px]">
            {documents.map((d) => <li key={d.id} className="flex justify-between gap-3 border-b border-rule pb-1.5"><span className="truncate">{d.title}</span><span className="num shrink-0 text-muted">{d.highlight_count} {d.highlight_count === 1 ? "highlight" : "highlights"}</span></li>)}
          </ul>
          {linked === 'done' && <p className="m-0 text-[13px] text-confirmed">Connected: {documents.length} papers, {highlights} highlights (demo library).</p>}
          {linked !== 'done'
            ? <button className="btn btn-primary w-full py-2.5" disabled={linked === 'busy'} onClick={connect}>{linked === 'busy' ? 'Connecting…' : 'Connect Papiers'}</button>
            : <button className="btn btn-primary w-full py-2.5" onClick={() => setStep(2)}>Continue</button>}
        </div>
      )}
      {step === 2 && (
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); begin(false, goal); nav('') }}>
          <p className="m-0 text-muted">Say what you want to find out. Agents will test the claims you highlighted.</p>
          <div><label htmlFor="g" className="text-[13px] font-medium">Research goal</label><input id="g" value={goal} onChange={(e) => setGoal(e.target.value)} className={field} /></div>
          <button type="submit" className="btn btn-primary w-full py-2.5">Start research</button>
        </form>
      )}
      <p className="mt-5 text-[14px] text-muted">Already have an account? <button className="border-0 bg-transparent p-0 text-ink underline underline-offset-2" onClick={() => nav('#/login')}>Log in</button></p>
    </Shell>
  )
}
