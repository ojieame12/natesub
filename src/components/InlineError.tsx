import { AlertCircle } from 'lucide-react'
import './InlineError.css'

interface InlineErrorProps {
  message: string
  className?: string
  style?: React.CSSProperties
}

export function InlineError({ message, className = '', style }: InlineErrorProps) {
  if (!message) return null

  return (
    <div className={`inline-error ${className}`} style={style}>
      <AlertCircle size={14} className="inline-error-icon" />
      <span className="inline-error-text">{message}</span>
    </div>
  )
}
