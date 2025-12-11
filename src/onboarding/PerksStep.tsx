import { useState } from 'react'
import { ChevronLeft, Check, Plus, X, Pencil } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import './onboarding.css'

export default function PerksStep() {
    const { perks, togglePerk, addPerk, updatePerk, removePerk, nextStep, prevStep } = useOnboardingStore()
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editValue, setEditValue] = useState('')
    const [showAddNew, setShowAddNew] = useState(false)
    const [newPerkValue, setNewPerkValue] = useState('')

    const enabledPerks = perks.filter(p => p.enabled)

    const handleStartEdit = (id: string, title: string) => {
        setEditingId(id)
        setEditValue(title)
    }

    const handleSaveEdit = () => {
        if (editingId && editValue.trim()) {
            updatePerk(editingId, editValue.trim())
        }
        setEditingId(null)
        setEditValue('')
    }

    const handleAddNew = () => {
        if (newPerkValue.trim()) {
            addPerk({
                id: `perk-${Date.now()}`,
                title: newPerkValue.trim(),
                enabled: true,
            })
            setNewPerkValue('')
            setShowAddNew(false)
        }
    }

    const handleRemove = (id: string) => {
        removePerk(id)
    }

    return (
        <div className="onboarding">
            <div className="onboarding-logo-header">
                <img src="/logo.svg" alt="NatePay" />
            </div>
            <div className="onboarding-header">
                <Pressable className="onboarding-back" onClick={prevStep}>
                    <ChevronLeft size={24} />
                </Pressable>
            </div>

            <div className="onboarding-content">
                <div className="step-header">
                    <h1>What will subscribers get?</h1>
                    <p>Select the perks you'll offer. These appear on your page.</p>
                </div>

                <div className="step-body perks-step-body">
                    <div className="perks-list">
                        {perks.map((perk) => (
                            <div key={perk.id} className="perk-item">
                                {editingId === perk.id ? (
                                    <div className="perk-editing">
                                        <input
                                            type="text"
                                            className="perk-edit-input"
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value)}
                                            autoFocus
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveEdit()
                                                if (e.key === 'Escape') setEditingId(null)
                                            }}
                                        />
                                        <Pressable className="perk-save-btn" onClick={handleSaveEdit}>
                                            <Check size={18} />
                                        </Pressable>
                                    </div>
                                ) : (
                                    <>
                                        <Pressable
                                            className={`perk-checkbox ${perk.enabled ? 'checked' : ''}`}
                                            onClick={() => togglePerk(perk.id)}
                                        >
                                            {perk.enabled && <Check size={14} />}
                                        </Pressable>
                                        <span
                                            className={`perk-title ${!perk.enabled ? 'disabled' : ''}`}
                                            onClick={() => togglePerk(perk.id)}
                                        >
                                            {perk.title}
                                        </span>
                                        <div className="perk-actions">
                                            <Pressable
                                                className="perk-action-btn"
                                                onClick={() => handleStartEdit(perk.id, perk.title)}
                                            >
                                                <Pencil size={14} />
                                            </Pressable>
                                            <Pressable
                                                className="perk-action-btn danger"
                                                onClick={() => handleRemove(perk.id)}
                                            >
                                                <X size={14} />
                                            </Pressable>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>

                    {showAddNew ? (
                        <div className="perk-add-form">
                            <input
                                type="text"
                                className="perk-add-input"
                                placeholder="Enter new perk..."
                                value={newPerkValue}
                                onChange={(e) => setNewPerkValue(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleAddNew()
                                    if (e.key === 'Escape') setShowAddNew(false)
                                }}
                            />
                            <Pressable className="perk-add-confirm" onClick={handleAddNew}>
                                <Check size={18} />
                            </Pressable>
                            <Pressable className="perk-add-cancel" onClick={() => setShowAddNew(false)}>
                                <X size={18} />
                            </Pressable>
                        </div>
                    ) : (
                        <Pressable className="add-perk-btn" onClick={() => setShowAddNew(true)}>
                            <Plus size={18} />
                            <span>Add custom perk</span>
                        </Pressable>
                    )}

                    {enabledPerks.length > 0 && (
                        <div className="perks-preview">
                            <span className="perks-preview-label">Preview on your page:</span>
                            <div className="perks-preview-list">
                                {enabledPerks.map((perk) => (
                                    <div key={perk.id} className="perks-preview-item">
                                        <img src="/check-badge.svg" alt="" className="perks-preview-badge" />
                                        <span>{perk.title}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={enabledPerks.length === 0}
                    >
                        Continue
                    </Button>
                    <p className="step-hint">Select at least one perk</p>
                </div>
            </div>
        </div>
    )
}
