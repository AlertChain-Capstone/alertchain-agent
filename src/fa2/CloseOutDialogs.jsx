import { useEffect, useRef, useState } from 'react'

function useModal(onCancel) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return { ref, onCancel: (e) => { e.preventDefault(); onCancel() } }
}

function listSteps(steps) {
  const numbers = steps.map((s) => s.number)
  return numbers.length === 1 ? `Step ${numbers[0]} is` : `Steps ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)} are`
}

// True positive – escalate. Extension 5b (open next steps) and 6a (no note).
export function EscalateDialog({ openSteps, onCancel, onSubmit }) {
  const modal = useModal(onCancel)
  const [note, setNote] = useState('')
  const open = openSteps.length > 0
  const empty = !note.trim()

  return (
    <dialog ref={modal.ref} onCancel={modal.onCancel} className="fa1-dialog" aria-labelledby="fa2-escalate-title">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(note.trim()) }}>
        <h2 id="fa2-escalate-title">
          {open ? `${openSteps.length} next ${openSteps.length === 1 ? 'step is' : 'steps are'} not ticked off` : 'Escalate as True positive'}
        </h2>
        <p className="fa2-dialog-text">
          {open
            ? `${listSteps(openSteps)} still open. Escalate anyway? Open steps are saved with the resolution so the next person sees them.`
            : 'Add a note for the record (optional). If you leave it empty, the resolution is saved with your name, the time and the ticked steps only.'}
        </p>
        <label className="fa2-field-label" htmlFor="fa2-escalate-note">{open ? 'Note (optional)' : 'Resolution note (optional)'}</label>
        <textarea
          id="fa2-escalate-note"
          className="fa2-textarea"
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={open ? 'e.g. Step 3 handed to the IR team; step 4 waiting on DevOps.' : 'Add a note…'}
        />
        <div className="fa1-actions">
          <button type="submit" className="fa1-primary">{open ? 'Escalate anyway' : empty ? 'Submit without note' : 'Submit'}</button>
          <button type="button" onClick={onCancel}>{open ? 'Go back' : 'Cancel'}</button>
        </div>
      </form>
    </dialog>
  )
}

// Close as Benign or False positive – extension 5a. A reason is required.
export function CloseAsDialog({ initialType, onCancel, onSubmit }) {
  const modal = useModal(onCancel)
  const [type, setType] = useState(initialType)
  const [reason, setReason] = useState('')

  return (
    <dialog ref={modal.ref} onCancel={modal.onCancel} className="fa1-dialog" aria-labelledby="fa2-close-title">
      <form onSubmit={(e) => { e.preventDefault(); if (reason.trim()) onSubmit(type, reason.trim()) }}>
        <h2 id="fa2-close-title">Close this alert without escalating?</h2>
        <p className="fa2-dialog-text">
          Choose why. Benign = the activity was real but expected. False positive = the detection was wrong. Your name, the time and the reason are saved.
        </p>
        <fieldset className="fa2-radios">
          <legend className="fa2-visually-hidden">Resolution</legend>
          <label><input type="radio" name="fa2-close-type" checked={type === 'Benign'} onChange={() => setType('Benign')} /> Benign – expected activity (e.g. planned key rotation)</label>
          <label><input type="radio" name="fa2-close-type" checked={type === 'False positive'} onChange={() => setType('False positive')} /> False positive – detection was wrong</label>
        </fieldset>
        <label className="fa2-field-label" htmlFor="fa2-close-reason">Reason (required)</label>
        <textarea
          id="fa2-close-reason"
          className="fa2-textarea"
          rows={4}
          value={reason}
          required
          aria-describedby="fa2-close-reason-help"
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. CI pipeline rotated its key as planned (change CHG-118)."
        />
        <p id="fa2-close-reason-help" className="fa1-muted">{reason.trim() ? ' ' : 'Enter a reason to enable closing.'}</p>
        <div className="fa1-actions">
          <button type="submit" className="fa1-primary" disabled={!reason.trim()}>Close as {type}</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </dialog>
  )
}
