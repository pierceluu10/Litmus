import { useStore } from './store'
import { TopBar } from './components/TopBar'
import { Library } from './components/Library'
import { Feed } from './components/Feed'
import { StarMap } from './components/StarMap'
import { Legend } from './components/Legend'
import { Dock } from './components/Dock'
import { Timeline } from './components/Timeline'
import { Sidebar } from './components/Sidebar'
import { AbstractPanel } from './components/AbstractPanel'
import { Landing } from './components/Landing'

export default function App() {
  const { app, abstractOpen } = useStore()
  if (!app.session) return <Landing />
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[270px_minmax(0,1fr)_350px] lg:overflow-hidden">
        <div className="flex min-h-0 flex-col border-r border-rule bg-surface max-lg:max-h-[60vh]"><Library /><Feed /></div>
        <div className="flex min-h-0 min-w-0 flex-col max-lg:h-[80vh]">
          <div className="relative min-h-0 flex-1"><StarMap /><Legend /><Dock /></div>
          <Timeline />
        </div>
        <div className="min-h-0 overflow-y-auto border-l border-rule bg-surface"><Sidebar /></div>
      </div>
      {abstractOpen && <AbstractPanel />}
    </div>
  )
}
