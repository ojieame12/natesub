import { useState } from 'react'
import { Check, Circle, X, Plus } from 'lucide-react'
import Pressable from './Pressable'
import './EditableList.css'

interface EditableListItem {
    id: string
    text: string
}

interface EditableListProps {
    items: EditableListItem[]
    onChange: (items: EditableListItem[]) => void
    variant?: 'check' | 'dot'
    placeholder?: string
    maxItems?: number
    label?: string
}

export function EditableList({
    items,
    onChange,
    variant = 'check',
    placeholder = 'Add item...',
    maxItems = 10,
    label,
}: EditableListProps) {
    const [editingId, setEditingId] = useState<string | null>(null)
    const [newItemText, setNewItemText] = useState('')

    const handleUpdate = (id: string, text: string) => {
        onChange(items.map(item => item.id === id ? { ...item, text } : item))
        setEditingId(null)
    }

    const handleRemove = (id: string) => {
        onChange(items.filter(item => item.id !== id))
    }

    const handleAdd = () => {
        if (!newItemText.trim() || items.length >= maxItems) return

        const newItem: EditableListItem = {
            id: `item-${Date.now()}`,
            text: newItemText.trim(),
        }
        onChange([...items, newItem])
        setNewItemText('')
    }

    const handleKeyDown = (e: React.KeyboardEvent, id?: string) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            if (id) {
                setEditingId(null)
            } else {
                handleAdd()
            }
        }
        if (e.key === 'Escape') {
            setEditingId(null)
            setNewItemText('')
        }
    }

    const Icon = variant === 'check' ? Check : Circle

    return (
        <div className="editable-list">
            {label && <label className="editable-list-label">{label}</label>}
            <div className="editable-list-items">
                {items.map((item, index) => (
                    <div
                        key={item.id}
                        className="editable-list-item"
                        style={{ animationDelay: `${index * 0.05}s` }}
                    >
                        <div className={`editable-list-icon ${variant}`}>
                            <Icon size={variant === 'check' ? 14 : 8} />
                        </div>
                        {editingId === item.id ? (
                            <input
                                type="text"
                                value={item.text}
                                onChange={(e) => handleUpdate(item.id, e.target.value)}
                                onBlur={() => setEditingId(null)}
                                onKeyDown={(e) => handleKeyDown(e, item.id)}
                                className="editable-list-input"
                                autoFocus
                            />
                        ) : (
                            <Pressable
                                className="editable-list-text"
                                onClick={() => setEditingId(item.id)}
                            >
                                {item.text}
                            </Pressable>
                        )}
                        <Pressable
                            className="editable-list-remove"
                            onClick={() => handleRemove(item.id)}
                        >
                            <X size={16} />
                        </Pressable>
                    </div>
                ))}

                {/* Add new item */}
                {items.length < maxItems && (
                    <div className="editable-list-add">
                        <div className="editable-list-icon add">
                            <Plus size={14} />
                        </div>
                        <input
                            type="text"
                            value={newItemText}
                            onChange={(e) => setNewItemText(e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e)}
                            placeholder={placeholder}
                            className="editable-list-input"
                        />
                        {newItemText.trim() && (
                            <Pressable
                                className="editable-list-add-btn"
                                onClick={handleAdd}
                            >
                                Add
                            </Pressable>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
