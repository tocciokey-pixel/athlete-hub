import { StrictMode } from 'react'
import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error("❌ CRASH DETECTED:", error)
    console.error("Component Stack:", errorInfo.componentStack)
    this.setState({
      error,
      errorInfo
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px 20px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          backgroundColor: '#fee7e7',
          color: '#8b2121',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '20px'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            ⚠️ エラーが発生しました
          </div>
          <div style={{ fontSize: '14px', padding: '15px', backgroundColor: '#fff5f5', borderRadius: '8px', fontFamily: 'monospace', maxHeight: '300px', overflowY: 'auto' }}>
            <div style={{ marginBottom: '10px' }}>
              <strong>エラー内容:</strong> {this.state.error?.toString()}
            </div>
            <div>
              <strong>詳細:</strong>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, marginTop: '10px' }}>
                {this.state.errorInfo?.componentStack}
              </pre>
            </div>
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold'
            }}
          >
            ページを再読み込み
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
