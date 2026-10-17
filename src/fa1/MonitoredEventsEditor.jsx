import { useEffect, useRef, useState } from 'react'

export default function MonitoredEventsEditor({
  selected,
  options,
  onSave,
  onClose,
}) {
  const dialogRef = useRef(null)
  const [draft, setDraft] = useState([...selected])
  const [eventName, setEventName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
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
    if (draft.length === 0 || error) return
    onSave(draft)
  }

  return (
    <dialog
      ref={dialogRef}
      className="fa1-dialog"
      aria-labelledby="events-editor-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <form onSubmit={saveChanges}>
        <h2 id="events-editor-title">
          Edit monitored CloudTrail events
        </h2>

        <p className="fa1-description">
          Only these events create alerts. At least one event is required.
        </p>

        <fieldset className="fa1-event-options">
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
            value={eventName}
            placeholder="For example, StopLogging"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'event-name-error' : undefined}
            onChange={(event) => {
              setEventName(event.target.value)
              setError('')
            }}
          />

          <button type="button" onClick={addEvent}>
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

        <div className="fa1-actions">
          <button
            type="submit"
            className="fa1-primary"
            disabled={draft.length === 0 || Boolean(error)}
          >
            Save changes
          </button>

          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  )
}