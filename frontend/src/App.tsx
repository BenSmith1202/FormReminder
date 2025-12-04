import { useEffect, useState } from 'react'

// Health check test
function App() {
  const [status, setStatus] = useState("Checking...")

  useEffect(() => {
    fetch('http://127.0.0.1:5000/api/health')
      .then(res => res.json())
      .then(data => setStatus(data.status))
      .catch(err => setStatus("Error connecting"))
  }, [])

  return (
    <div>
      <h1>System Status: {status}</h1>
    </div>
  )
}
export default App