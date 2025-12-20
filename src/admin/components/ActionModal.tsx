/**
 * ActionModal - Confirmation modal with optional input
 */

import { useState } from 'react'

interface ActionModalProps {
  title: string
  message: string
  confirmLabel?: string
  confirmVariant?: 'primary' | 'danger'
  inputLabel?: string
  inputPlaceholder?: string
  inputRequired?: boolean
  loading?: boolean
  onConfirm: (inputValue?: string) => void
  onCancel: () => void
}

export default function ActionModal({
  title,
  message,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
  inputLabel,
  inputPlaceholder,
  inputRequired = false,
  loading = false,
  onConfirm,
  onCancel,
}: ActionModalProps) {
  const [inputValue, setInputValue] = useState('')

  const handleConfirm = () => {
    if (inputRequired && !inputValue.trim()) return
    onConfirm(inputValue.trim() || undefined)
  }

  return (
    <div className="admin-modal-overlay" onClick={onCancel}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h2 className="admin-modal-title">{title}</h2>
        </div>
        <div className="admin-modal-body">
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>{message}</p>
          {inputLabel && (
            <div className="admin-form-group">
              <label className="admin-form-label">{inputLabel}</label>
              <textarea
                className="admin-form-textarea"
                placeholder={inputPlaceholder}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={loading}
              />
            </div>
          )}
        </div>
        <div className="admin-modal-footer">
          <button
            className="admin-btn admin-btn-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            className={`admin-btn ${confirmVariant === 'danger' ? 'admin-btn-danger' : 'admin-btn-primary'}`}
            onClick={handleConfirm}
            disabled={loading || (inputRequired && !inputValue.trim())}
          >
            {loading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
