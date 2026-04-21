import { createRoot } from 'react-dom/client'
import { Suspense, lazy } from 'react'
import './index.css'

// Inline minimal loading screen while app chunks load
function LoadingScreen() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#020617', color: '#94a3b8',
      fontFamily: 'system-ui, sans-serif', fontSize: 14
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 32, height: 32, border: '3px solid #1e293b',
          borderTopColor: '#3b82f6', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite', margin: '0 auto 12px'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div>Loading Neiry BT Diagnostics...</div>
      </div>
    </div>
  )
}

const App = lazy(() => import('./App'))

createRoot(document.getElementById('root')!).render(
  <Suspense fallback={<LoadingScreen />}>
    <App />
  </Suspense>
)
