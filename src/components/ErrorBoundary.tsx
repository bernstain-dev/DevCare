import { Component, type ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <main className="setup">
          <AlertCircle size={35} />
          <h1>The workspace couldn’t load.</h1>
          <p>Reload to try again. If this continues, contact your developer.</p>
          <button className="btn gray" onClick={() => window.location.reload()}>
            <RefreshCw size={17} />
            Reload App
          </button>
        </main>
      )
    return this.props.children
  }
}
