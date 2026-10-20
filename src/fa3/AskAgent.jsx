import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { answerQuestion } from './fa3Data.js'
import { DemoControl, Notice, PageHeading, Unavailable } from './Ui.jsx'
import EvidenceDialog from './EvidenceDialog.jsx'

export default function AskAgent({ incident, session, setSession }) {
  const [pending, setPending] = useState(false)
  const [scenario, setScenario] = useState('normal')
  const [evidenceScenario, setEvidenceScenario] = useState('normal')
  const [citation, setCitation] = useState(null)
  const timer = useRef(null)
  const input = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const { question, response, submittedQuestion } = session

  function edit(value) {
    clearTimeout(timer.current)
    setPending(false)
    setSession({ question: value, response: null, submittedQuestion: '' })
  }
  function submit(retry = false) {
    if (pending) return
    if (!question.trim()) {
      setSession({ ...session, response: answerQuestion(incident, question) })
      input.current?.focus()
      return
    }
    setPending(true)
    setSession({ ...session, response: null, submittedQuestion: question.trim() })
    timer.current = setTimeout(() => {
      setPending(false)
      setSession({ question, submittedQuestion: question.trim(), response: answerQuestion(incident, question, retry ? 'normal' : scenario) })
    }, 850)
  }
  return (
    <>
      <PageHeading title="Ask the Agent" eyebrow={`INCIDENT QUESTION · ${incident.id}`}><p>{incident.title}</p></PageHeading>
      <div className="fa3-actions"><Link to={`/incidents/${incident.id}`}>← Return to report</Link><span className="fa3-muted">Stored evidence only · Canned answers in this prototype</span></div>
      <DemoControl id="ask-scenario" label="Answer demo scenario" value={scenario} onChange={(value) => { edit(question); setScenario(value) }} options={[['normal', 'Canned answer'], ['scope', 'Question outside incident scope'], ['insufficient', 'Insufficient evidence'], ['timeout', 'Agent timeout'], ['invalid', 'Candidate has invalid citations'], ['unavailable', 'Incident becomes unavailable']]} />
      {scenario === 'unavailable' ? <Unavailable id={incident.id} /> : <div className="fa3-ask-grid">
        <section className="fa3-card">
          <h2>A question about this incident</h2>
          <p className="fa3-muted">Ask for an explanation of the recorded activity. This view cannot perform AWS changes.</p>
          {incident.answers.length > 0 && <div className="fa3-suggestions"><p>Try a suggested question</p>{incident.answers.map((answer) => <button key={answer.question} disabled={pending} onClick={() => { edit(answer.question); input.current?.focus() }}>{answer.question}</button>)}</div>}
          <form onSubmit={(event) => { event.preventDefault(); submit() }}>
            <label htmlFor="incident-question">Your question</label>
            <textarea id="incident-question" ref={input} rows={3} maxLength={1000} value={question} disabled={pending} aria-invalid={response?.kind === 'validation'} aria-describedby={response?.kind === 'validation' ? 'question-validation' : 'question-hint'} onChange={(e) => edit(e.target.value)} placeholder="Ask about this incident…" />
            <div className="fa3-section-heading"><small id="question-hint">{question.length}/1000 characters · {incident.id}</small><button className="fa3-primary" disabled={pending} type="submit">{pending ? 'Preparing answer…' : 'Ask question'}</button></div>
            {response?.kind === 'validation' && <p className="fa3-error" id="question-validation" role="alert">{response.text}</p>}
          </form>
          <div className="fa3-response" aria-live="polite" aria-atomic="true" aria-busy={pending}>
            {pending && <Notice title="Preparing an answer…"><p>Checking the selected incident’s stored evidence.</p></Notice>}
            {response && response.kind !== 'validation' && <>
              <p className="fa3-question-bubble">{submittedQuestion}</p>
              {response.kind === 'answer' ? <article className="fa3-answer"><p className="fa3-eyebrow">AGENT · {response.partial ? 'PARTIAL ANSWER' : 'EVIDENCE-SUPPORTED ANSWER'}</p><p>{response.text}</p>{response.limitation && <p className="fa3-answer-limitation">{response.limitation}</p>}<div className="fa3-citations">{response.citations.map((id) => <button key={id} onClick={() => setCitation(id)}>View citation {id}</button>)}</div></article>
                : <Notice title={response.kind === 'timeout' ? 'Agent unavailable' : 'Answer limitation'} error={response.kind === 'timeout'}><p>{response.text}</p>{response.kind === 'timeout' && <button onClick={() => submit(true)}>Retry answer</button>}</Notice>}
            </>}
          </div>
        </section>
        <aside className="fa3-stack">
          <section className="fa3-card"><h2>Evidence for {incident.id}</h2><p className="fa3-muted">Select a citation below an answer to inspect its stored source without losing your question.</p>{incident.evidence.length ? incident.evidence.map((item) => <div className="fa3-evidence-summary" key={item.id}><span className="fa3-evidence-id">{item.id}</span><div><strong>{item.eventName}</strong><small>{item.source} · {item.alertId}</small></div></div>) : <p>No stored evidence is available.</p>}</section>
          <section className="fa3-card fa3-guidance"><h2>Verify before concluding</h2><p>Answers distinguish recorded facts from uncertainty. Missing evidence never becomes a confirmed finding.</p></section>
          <DemoControl id="evidence-scenario" label="Evidence demo scenario" value={evidenceScenario} onChange={setEvidenceScenario} options={[['normal', 'Stored evidence'], ['missing', 'Evidence missing'], ['error', 'Temporary load error'], ['invalid', 'Citation belongs to another incident'], ['large', 'Segmented raw-evidence preview']]} />
        </aside>
      </div>}
      {citation && <EvidenceDialog incident={incident} citation={citation} scenario={evidenceScenario} onClose={() => setCitation(null)} />}
    </>
  )
}
