import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { StoreProvider } from './lib/store'
import { Shell } from './components/Shell'
import { Dashboard } from './screens/Dashboard'
import { NewEvaluation } from './screens/NewEvaluation'
import { DealRoom } from './screens/DealRoom'
import { DealDetail } from './screens/DealDetail'
import { Creators } from './screens/Creators'
import { AgentTraces } from './screens/AgentTraces'
import { AuditLog } from './screens/AuditLog'

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Shell>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/evaluate" element={<NewEvaluation />} />
            <Route path="/deal-room" element={<DealRoom />} />
            <Route path="/deal/:id" element={<DealDetail />} />
            <Route path="/creators" element={<Creators />} />
            <Route path="/traces" element={<AgentTraces />} />
            <Route path="/audit" element={<AuditLog />} />
          </Routes>
        </Shell>
      </BrowserRouter>
    </StoreProvider>
  )
}
