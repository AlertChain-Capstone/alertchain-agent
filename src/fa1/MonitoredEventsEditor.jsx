import { useEffect, useRef, useState } from 'react'

export default function MonitoredEventsEditor({
  selected,
  options,
  onSave,
  onClose,
}) {
  const dialogRef = useRef(null)
  const saveTimer = useRef(null)
  const [draft, setDraft] = useState([...selected])
  const [eventName, setEventName] = useState('')
  const [error, setError] = useState('')
  const [simulateFailure, setSimulateFailure] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const saving = saveState === 'saving'

  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => {
      clearTimeout(saveTimer.current)
      dialog.close()
    }
  }, [])

  function toggleEvent(name) {
    setDraft((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name]
    )
  }

  function addEvent() {
    const name = eventName.trim()

    if (!options.includes(name)) {
      setError(
        name === 'StopLoging'
          ? 'Event name not recognized: "StopLoging". Did you mean StopLogging?'
          : 'Choose a supported event name from the list above.'
      )
      return
    }

    setDraft((current) =>
      current.includes(name) ? current : [...current, name]
    )
    setEventName('')
    setError('')
  }

  function saveChanges(event) {
    event.preventDefault()
    if (draft.length === 0 || error || saveTimer.current !== null) return
    if (!simulateFailure && saveState !== 'failed') {
      onSave(draft)
      return
    }
    const fail = simulateFailure && saveState !== 'failed'
    setSaveState('saving')
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      if (fail) setSaveState('failed')
      else onSave(draft)
    }, 800)
  }

  function cancelChanges() {
    clearTimeout(saveTimer.current)
    saveTimer.current = null
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="fa1-dialog"
      aria-labelledby="events-editor-title"
      onCancel={(event) => {
        event.preventDefault()
        cancelChanges()
      }}
    >
      <form onSubmit={saveChanges}>
        <h2 id="events-editor-title">
          Edit monitored CloudTrail events
        </h2>

        <p className="fa1-description">
          Only these events create alerts. At least one event is required.
        </p>

        <div className="fa1-save-demo">
          <label>
            <input type="checkbox" checked={simulateFailure} disabled={saving} onChange={(event) => setSimulateFailure(event.target.checked)} />
            Demo: simulate a failed save
          </label>
          <p className="fa1-muted">Save will fail once. Retry simulates a successful save.</p>
        </div>

        <fieldset className="fa1-event-options" disabled={saving}>
          <legend className="fa1-muted">Select events to monitor</legend>

          {options.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={draft.includes(name)}
                onChange={() => toggleEvent(name)}
              />
              {name === 'ConsoleLogin' ? 'ConsoleLogin (failed)' : name}
            </label>
          ))}
        </fieldset>

        <label className="fa1-muted" htmlFor="event-name">
          Add a supported event by name
        </label>

        <div className="fa1-add-event">
          <input
            id="event-name"
            disabled={saving}
            value={eventName}
            placeholder="For example, StopLogging"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'event-name-error' : undefined}
            onChange={(event) => {
              setEventName(event.target.value)
              setError('')
            }}
          />

          <button type="button" disabled={saving} onClick={addEvent}>
            Add
          </button>
        </div>

        {error && (
          <p id="event-name-error" className="fa1-error" role="alert">
            {error}
          </p>
        )}

        {draft.length === 0 && (
          <p className="fa1-error" role="status">
            Select at least one event before saving.
          </p>
        )}

        <p className="fa1-save-status" role="status" aria-atomic="true">{saving ? 'Saving monitored events…' : ''}</p>
        {saveState === 'failed' && (
          <p className="fa1-error" role="alert">
            Simulated save failed. Your draft is retained and the saved configuration has not changed. Retry to save successfully, or Cancel to discard the draft.
          </p>
        )}

        <div className="fa1-actions">
          <button
            type="submit"
            className="fa1-primary"
            disabled={saving || draft.length === 0 || Boolean(error)}
          >
            {saving ? 'Saving…' : saveState === 'failed' ? 'Retry' : 'Save changes'}
          </button>

          <button type="button" onClick={cancelChanges}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  )
}
