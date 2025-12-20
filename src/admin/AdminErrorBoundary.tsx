import React from 'react'
import { Pressable } from '../components'

type Props = {
  children: React.ReactNode
}

type State = {
  error: Error | null
}

export default class AdminErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[admin] Unhandled UI error:', error)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="admin-error-page">
        <div className="admin-error-content">
          <div className="admin-error-icon">!</div>
          <h1>Something went wrong</h1>
          <p>The admin dashboard hit an unexpected error. Reload to try again.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Pressable className="admin-error-btn" onClick={() => window.location.reload()}>
              Reload
            </Pressable>
            <a className="admin-error-btn" href="/dashboard">
              Back to App
            </a>
          </div>
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted, #999)' }}>
            {this.state.error.message}
          </div>
        </div>
      </div>
    )
  }
}

