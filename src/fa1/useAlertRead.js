import { useEffect, useState } from 'react'

// Abort the transport and guard completions: even a transport ignoring abort cannot win a race.
export default function useAlertRead(key, load, enabled = true) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let current = true
    Promise.resolve().then(() => load(controller.signal)).then(
      (data) => { if (current) setResult({ key, attempt, status: 'ready', data }) },
      (error) => { if (current && error.name !== 'AbortError') setResult({ key, attempt, status: 'error', error }) },
    )
    return () => {
      current = false
      controller.abort()
    }
  }, [key, load, enabled, attempt])
  const state = !enabled ? { status: 'idle' }
    : result?.key === key && result?.attempt === attempt ? result : { status: 'loading' }
  return { ...state, retry: () => setAttempt((value) => value + 1) }
}
