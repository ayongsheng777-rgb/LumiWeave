import { useEffect, useState } from 'react'
import { checkAuth } from './api'
import Dashboard from './components/Dashboard'
import Login from './components/Login'

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    checkAuth().then((r) => setAuthed(r.authed))
  }, [])

  if (authed === null) {
    return (
      <div className="loading">
        <img src="/logo.jpg" alt="绵绣 LumiWeave" className="loading-logo" />
        <p>加载中…</p>
      </div>
    )
  }

  return authed ? <Dashboard onLogout={() => setAuthed(false)} /> : <Login onLogin={() => setAuthed(true)} />
}

export default App
