import { create } from 'zustand'

// shortcut: fake client-side auth against one hardcoded demo account, so the front end can be built without a
// backend; replace with real auth before this is shared publicly.
export const DEMO = { name: 'Demo Researcher', email: 'demo@litmus.dev', password: 'litmus-demo' }

type User = { name: string; email: string }
const KEY = 'litmus.user'
const read = (): User | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null } }
const write = (u: User | null) => { try { if (u) localStorage.setItem(KEY, JSON.stringify(u)); else localStorage.removeItem(KEY) } catch { /* storage unavailable: stay signed in for this tab only */ } }

export const useAuth = create<{ user: User | null; login: (email: string, password: string) => boolean; signup: (name: string, email: string) => void; logout: () => void }>((set) => ({
  user: read(),
  login: (email, password) => {
    const ok = email.trim().toLowerCase() === DEMO.email && password === DEMO.password
    if (ok) { const u = { name: DEMO.name, email: DEMO.email }; write(u); set({ user: u }) }
    return ok
  },
  signup: (name, email) => { const u = { name, email }; write(u); set({ user: u }) },
  logout: () => { write(null); set({ user: null }) },
}))

export const nav = (to: string) => { location.hash = to }
