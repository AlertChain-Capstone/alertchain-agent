export default function StoredEvidence({ item }) {
  return <>
    <p>{item.summary}</p>
    {item.raw != null && <details>
      <summary>Inspect stored evidence {item.id}</summary>
      <pre tabIndex={0} aria-label={`Stored evidence ${item.id}`}>{JSON.stringify(item.raw, null, 2)}</pre>
    </details>}
  </>
}
