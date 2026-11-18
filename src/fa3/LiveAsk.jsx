import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { incidentsApi } from './api.js'
import StoredEvidence from './StoredEvidence.jsx'
import { Notice, PageHeading } from './Ui.jsx'

export default function LiveAsk({ incident, session, setSession }) {
  const request = useRef(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  const { question, response, submittedQuestion } = session
  const evidence = new Map(incident.evidence.map((item) => [item.id, item]))
  const citationsAvailable = response?.citations.every((id) => evidence.has(id))
  useEffect(() => () => request.current?.abort(), [])

  async function submit(event) {
    event.preventDefault()
    if (pending) return
    const text = question.trim()
    if (!text) {
      setError('Enter a question about this incident.')
      input.current.focus()
      return
    }
    const controller = new AbortController()
    request.current = controller
    setError('')
    setPending(true)
    setSession({ question, submittedQuestion: text, response: null })
    try {
      const answer = await incidentsApi.ask(incident, text, { signal: controller.signal })
      if (!controller.signal.aborted) setSession({ question, submittedQuestion: text, response: answer })
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err.status === 404 ? 'This incident is no longer available.' : 'Could not load an answer. Try again.')
      }
    } finally {
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return <>
    <PageHeading title="Ask the Agent" eyebrow={`INCIDENT QUESTION · ${incident.id}`}><p>{incident.title}</p></PageHeading>
    <div className="fa3-actions"><Link to={`/incidents/${encodeURIComponent(incident.id)}`}>← Return to report</Link></div>
    <section className="fa3-card fa3-live-ask">
      <form onSubmit={submit}>
        <label htmlFor="incident-question">Your question</label>
        <textarea id="incident-question" ref={input} rows={3} maxLength={1000} value={question} disabled={pending}
          placeholder="What does the evidence show?" onChange={(event) => {
            setSession({ question: event.target.value, submittedQuestion: '', response: null })
            setError('')
          }} />
        <div className="fa3-section-heading">
          <small>{question.length}/1000 characters</small>
          <button className="fa3-primary" disabled={pending}>Ask question</button>
        </div>
        {error && <p className="fa3-error" role="alert">{error}</p>}
      </form>
      <div className="fa3-response" aria-live="polite" aria-busy={pending}>
        {pending && <p role="status">Reading the incident evidence…</p>}
        {response && <>
          <p className="fa3-question-bubble">{submittedQuestion}</p>
          {response.kind === 'limitation' ? <Notice title="Insufficient evidence"><p>{response.text}</p></Notice>
            : !citationsAvailable ? <Notice title="Evidence unavailable"><p>A source for this answer is no longer available.</p></Notice> :
            <article className="fa3-answer fa3-recorded-evidence">
              <h2>Answer</h2><p>{response.text}</p>
              {response.citations.map((id) => {
                const item = evidence.get(id)
                return <details key={id}>
                  <summary>View citation {id}</summary>
                  <p><strong>{item.source}</strong></p><StoredEvidence item={item} />
                </details>
              })}
            </article>}
        </>}
      </div>
    </section>
  </>
}
