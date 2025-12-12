import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Heart, Users, Briefcase, Star, UserPlus, Sparkles, UserCheck, UserPlus2, Share2 } from 'lucide-react'
import { useRequestStore, type RelationshipType } from './store'
import { useCurrentUser } from '../api/hooks'
import { Pressable } from '../components'
import './request.css'

interface RelationshipOption {
    id: RelationshipType
    label: string
    icon: React.ReactNode
    color: string
}

// Personal user relationship groups
const personalRelationshipGroups: { title: string; options: RelationshipOption[] }[] = [
    {
        title: 'Family',
        options: [
            { id: 'family_mom', label: 'Mom', icon: <Heart size={20} />, color: '#ec4899' },
            { id: 'family_dad', label: 'Dad', icon: <Heart size={20} />, color: '#ec4899' },
            { id: 'family_sibling', label: 'Sibling', icon: <Users size={20} />, color: '#ec4899' },
            { id: 'family_spouse', label: 'Spouse', icon: <Heart size={20} />, color: '#ec4899' },
            { id: 'family_child', label: 'Child', icon: <Heart size={20} />, color: '#ec4899' },
            { id: 'family_grandparent', label: 'Grandparent', icon: <Heart size={20} />, color: '#ec4899' },
        ],
    },
    {
        title: 'Friends',
        options: [
            { id: 'friend_close', label: 'Close Friend', icon: <Users size={20} />, color: '#8b5cf6' },
            { id: 'friend_acquaintance', label: 'Friend', icon: <Users size={20} />, color: '#8b5cf6' },
        ],
    },
    {
        title: 'Professional',
        options: [
            { id: 'client', label: 'Client', icon: <Briefcase size={20} />, color: '#3b82f6' },
            { id: 'colleague', label: 'Colleague', icon: <Briefcase size={20} />, color: '#3b82f6' },
        ],
    },
    {
        title: 'Other',
        options: [
            { id: 'fan', label: 'Fan/Supporter', icon: <Star size={20} />, color: '#f59e0b' },
            { id: 'partner', label: 'Partner', icon: <Heart size={20} />, color: '#10b981' },
            { id: 'other', label: 'Someone Else', icon: <UserPlus size={20} />, color: '#6b7280' },
        ],
    },
]

// Service provider relationship groups (clients only)
const serviceRelationshipGroups: { title: string; options: RelationshipOption[] }[] = [
    {
        title: 'Client Type',
        options: [
            { id: 'client', label: 'Existing Client', icon: <UserCheck size={20} />, color: '#10b981' },
            { id: 'client_new', label: 'New Client', icon: <UserPlus2 size={20} />, color: '#3b82f6' },
            { id: 'client_referral', label: 'Referral', icon: <Share2 size={20} />, color: '#8b5cf6' },
            { id: 'other', label: 'Other', icon: <UserPlus size={20} />, color: '#6b7280' },
        ],
    },
]

export default function SelectRelationship() {
    const navigate = useNavigate()
    const { data: userData } = useCurrentUser()
    const isService = userData?.profile?.purpose === 'service'
    const { recipient, relationship, setRelationship } = useRequestStore()

    // Use appropriate relationship options based on user type
    const relationshipGroups = isService ? serviceRelationshipGroups : personalRelationshipGroups

    if (!recipient) {
        navigate('/request/new')
        return null
    }

    const handleSelect = (type: RelationshipType) => {
        setRelationship(type)
        navigate('/request/details')
    }

    const firstName = recipient.name.split(' ')[0]

    return (
        <div className="request-page">
            {/* Header */}
            <header className="request-header">
                <Pressable className="request-back-btn" onClick={() => navigate(-1)}>
                    <ChevronLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <div className="request-header-spacer" />
            </header>

            <div className="request-content">
                {/* Recipient Preview */}
                <div className="request-recipient-preview">
                    <div className="request-recipient-avatar-large">
                        {recipient.name.charAt(0).toUpperCase()}
                    </div>
                    <h2 className="request-recipient-name">{recipient.name}</h2>
                    <p className="request-recipient-prompt">
                        {isService ? (
                            <>What type of client is <span className="highlight">{firstName}</span>?</>
                        ) : (
                            <>How do you know <span className="highlight">{firstName}</span>?</>
                        )}
                    </p>
                </div>

                {/* Relationship Options */}
                <div className="request-relationship-groups">
                    {relationshipGroups.map((group) => (
                        <div key={group.title} className="request-relationship-group">
                            <h3 className="request-group-title">{group.title}</h3>
                            <div className="request-relationship-options">
                                {group.options.map((option) => (
                                    <Pressable
                                        key={option.id}
                                        className={`request-relationship-option ${relationship === option.id ? 'selected' : ''}`}
                                        onClick={() => handleSelect(option.id)}
                                    >
                                        <div
                                            className="request-relationship-icon"
                                            style={{ background: `${option.color}15`, color: option.color }}
                                        >
                                            {option.icon}
                                        </div>
                                        <span className="request-relationship-label">{option.label}</span>
                                    </Pressable>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Smart Suggestion */}
                <div className="request-suggestion">
                    <Sparkles size={16} />
                    <span>Relationship helps personalize your request message</span>
                </div>
            </div>
        </div>
    )
}
