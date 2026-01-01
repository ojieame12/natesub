import { useState, createContext, useContext, useEffect, type ReactNode } from 'react'
import { Check, X, AlertCircle, Info } from 'lucide-react'
import { useHaptics } from '../hooks'
import './Toast.css'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
    id: string
    message: string
    type: ToastType
    duration?: number
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType, duration?: number) => void
    success: (message: string) => void
    error: (message: string) => void
    warning: (message: string) => void
    info: (message: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

const createToastId = () => `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

export function useToast() {
    const context = useContext(ToastContext)
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider')
    }
    return context
}

interface ToastProviderProps {
    children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
    const [toasts, setToasts] = useState<Toast[]>([])

    const showToast = (message: string, type: ToastType = 'info', duration = 3000) => {
        const id = createToastId()
        const newToast: Toast = { id, message, type, duration }

        setToasts(prev => [...prev, newToast])

        if (duration > 0) {
            setTimeout(() => {
                removeToast(id)
            }, duration)
        }
    }

    const removeToast = (id: string) => {
        setToasts(prev => prev.filter(toast => toast.id !== id))
    }

    const success = (message: string) => showToast(message, 'success')
    const error = (message: string) => showToast(message, 'error')
    const warning = (message: string) => showToast(message, 'warning')
    const info = (message: string) => showToast(message, 'info')

    return (
        <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
            {children}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </ToastContext.Provider>
    )
}

interface ToastContainerProps {
    toasts: Toast[]
    onRemove: (id: string) => void
}

function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
    if (toasts.length === 0) return null

    return (
        <div className="toast-container">
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
            ))}
        </div>
    )
}

interface ToastItemProps {
    toast: Toast
    onRemove: (id: string) => void
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
    const [isExiting, setIsExiting] = useState(false)

    const handleRemove = () => {
        setIsExiting(true)
        setTimeout(() => {
            onRemove(toast.id)
        }, 200)
    }

    const { success, error, warning, notification } = useHaptics()

    // Trigger semantic haptics on mount
    useEffect(() => {
        switch (toast.type) {
            case 'success': success(); break
            case 'error': error(); break
            case 'warning': warning(); break
            case 'info': notification('success'); break // Use light success for info
        }
    }, [toast.type, success, error, warning, notification])

    // ... existing remove logic ...

    const getIcon = () => {
        switch (toast.type) {
            case 'success':
                return <Check size={18} />
            case 'error':
                return <X size={18} />
            case 'warning':
                return <AlertCircle size={18} />
            case 'info':
                return <Info size={18} />
        }
    }

    return (
        <div
            className={`toast-item toast-${toast.type} ${isExiting ? 'toast-exit' : ''}`}
            onClick={handleRemove}
        >
            <div className="toast-icon">{getIcon()}</div>
            <span className="toast-message">{toast.message}</span>
        </div>
    )
}
