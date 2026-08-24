import { useEffect, useState } from 'react'
import { checkAuth } from './api'
import Login from './components/Login'
import Workspace from './components/Workspace'
import { useUiStore } from './store/uiStore'

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const initTheme = useUiStore((s) => s.initTheme)

  useEffect(() => {
    initTheme()
    checkAuth().then((r) => setAuthed(r.authed))
  }, [initTheme])

  if (authed === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-canvas text-ink-2">
        <img src="/logo.jpg" alt="绵绣 LumiWeave" className="h-24 w-24 rounded-2xl shadow-lg shadow-brand-500/20" />
        <p className="mt-4 text-sm text-ink-2">加载中…</p>
      </div>
    )
  }

  return authed ? <Workspace /> : <Login onLogin={() => setAuthed(true)} />
}

export default App
