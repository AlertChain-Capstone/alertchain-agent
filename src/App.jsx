import { useEffect, useState } from 'react'
import Fa1App from './fa1/Fa1App.jsx'
import Fa1Layout from './fa1/Fa1Layout.jsx'
import Fa2App from './fa2/Fa2App.jsx'
import Fa2Layout from './fa2/Fa2Layout.jsx'

// Each functional area keeps its own prototype. FA1 is the default;
// FA2 (investigations) opens at #/investigations until a shared router exists.
const FA2_HASH = '#/investigations'

function currentArea() {
  return window.location.hash.startsWith(FA2_HASH) ? 'fa2' : 'fa1'
}

export default function App() {
  const [area, setArea] = useState(currentArea)

  useEffect(() => {
    const onHashChange = () => setArea(currentArea())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (area === 'fa2') {
    return (
      <Fa2Layout>
        <Fa2App />
      </Fa2Layout>
    )
  }

  return (
    <Fa1Layout>
      <Fa1App />
    </Fa1Layout>
  )
}
