import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Search, User, Phone, Mail, ChevronRight, Users } from 'lucide-react'
import { useRequestStore, type Recipient } from './store'
import { useCurrentUser } from '../api/hooks'
import { Pressable } from '../components'
import './request.css'

// Mock contacts data - personal
const personalContacts: Recipient[] = [
    { id: '1', name: 'Mom', phone: '+1 (555) 123-4567' },
    { id: '2', name: 'Dad', phone: '+1 (555) 234-5678' },
    { id: '3', name: 'Sarah Johnson', phone: '+1 (555) 345-6789', email: 'sarah@email.com' },
    { id: '4', name: 'Mike Chen', email: 'mike.chen@gmail.com' },
    { id: '5', name: 'Jessica Williams', phone: '+1 (555) 456-7890' },
]

// Mock contacts data - service (clients)
const serviceContacts: Recipient[] = [
    { id: '1', name: 'Acme Corp', email: 'billing@acme.com' },
    { id: '2', name: 'John Smith', email: 'john.smith@company.com' },
    { id: '3', name: 'Sarah Chen', phone: '+1 (555) 345-6789', email: 'sarah@startup.io' },
    { id: '4', name: 'Tech Solutions LLC', email: 'accounts@techsol.com' },
    { id: '5', name: 'Maria Garcia', email: 'maria.g@email.com' },
]

export default function SelectRecipient() {
    const navigate = useNavigate()
    const { data: userData } = useCurrentUser()
    const isService = userData?.profile?.purpose === 'service'
    const { setRecipient, reset } = useRequestStore()

    // Use appropriate contacts based on user type
    const mockContacts = isService ? serviceContacts : personalContacts
    const recentContacts = mockContacts.slice(0, 3)
    const [searchQuery, setSearchQuery] = useState('')
    const [showManualEntry, setShowManualEntry] = useState(false)
    const [manualName, setManualName] = useState('')
    const [manualContact, setManualContact] = useState('')

    const filteredContacts = mockContacts.filter(contact =>
        contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contact.phone?.includes(searchQuery) ||
        contact.email?.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const handleSelectContact = (contact: Recipient) => {
        setRecipient(contact)
        navigate('/request/relationship')
    }

    const handleManualSubmit = () => {
        if (!manualName.trim()) return

        const isEmail = manualContact.includes('@')
        const newRecipient: Recipient = {
            id: `manual-${Date.now()}`,
            name: manualName.trim(),
            ...(isEmail ? { email: manualContact } : { phone: manualContact }),
        }
        setRecipient(newRecipient)
        navigate('/request/relationship')
    }

    const handleClose = () => {
        reset()
        navigate(-1)
    }

    return (
        <div className="request-page">
            {/* Header */}
            <header className="request-header">
                <Pressable className="request-close-btn" onClick={handleClose}>
                    <X size={20} />
                </Pressable>
                <span className="request-title">{isService ? 'Bill Client' : 'New Request'}</span>
                <div className="request-header-spacer" />
            </header>

            {/* Search */}
            <div className="request-search-section">
                <div className="request-search-bar">
                    <Search size={18} className="request-search-icon" />
                    <input
                        type="text"
                        placeholder={isService ? "Search clients..." : "Search contacts..."}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="request-search-input"
                    />
                </div>
            </div>

            <div className="request-content">
                {/* Manual Entry Toggle */}
                <Pressable
                    className="request-manual-toggle"
                    onClick={() => setShowManualEntry(!showManualEntry)}
                >
                    <div className="request-manual-icon">
                        {showManualEntry ? <Users size={20} /> : <User size={20} />}
                    </div>
                    <span>{showManualEntry ? 'Choose from contacts' : 'Enter manually'}</span>
                    <ChevronRight size={18} className="request-chevron" />
                </Pressable>

                {showManualEntry ? (
                    /* Manual Entry Form */
                    <div className="request-manual-form">
                        <div className="request-input-group">
                            <label className="request-input-label">Name</label>
                            <div className="request-input-wrapper">
                                <User size={18} className="request-input-icon" />
                                <input
                                    type="text"
                                    placeholder="Enter name"
                                    value={manualName}
                                    onChange={(e) => setManualName(e.target.value)}
                                    className="request-input"
                                />
                            </div>
                        </div>

                        <div className="request-input-group">
                            <label className="request-input-label">Phone or Email</label>
                            <div className="request-input-wrapper">
                                {manualContact.includes('@') ? (
                                    <Mail size={18} className="request-input-icon" />
                                ) : (
                                    <Phone size={18} className="request-input-icon" />
                                )}
                                <input
                                    type="text"
                                    placeholder="Phone number or email"
                                    value={manualContact}
                                    onChange={(e) => setManualContact(e.target.value)}
                                    className="request-input"
                                />
                            </div>
                        </div>

                        <Pressable
                            className={`request-continue-btn ${manualName.trim() ? '' : 'disabled'}`}
                            onClick={handleManualSubmit}
                        >
                            Continue
                        </Pressable>
                    </div>
                ) : (
                    /* Contacts List */
                    <>
                        {/* Recent Section */}
                        {!searchQuery && recentContacts.length > 0 && (
                            <div className="request-contacts-section">
                                <h3 className="request-section-title">{isService ? 'Recent Clients' : 'Recent'}</h3>
                                <div className="request-contacts-list">
                                    {recentContacts.map((contact) => (
                                        <Pressable
                                            key={contact.id}
                                            className="request-contact-item"
                                            onClick={() => handleSelectContact(contact)}
                                        >
                                            <div className="request-contact-avatar">
                                                {contact.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="request-contact-info">
                                                <span className="request-contact-name">{contact.name}</span>
                                                <span className="request-contact-detail">
                                                    {contact.phone || contact.email}
                                                </span>
                                            </div>
                                            <ChevronRight size={18} className="request-chevron" />
                                        </Pressable>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* All Contacts Section */}
                        <div className="request-contacts-section">
                            <h3 className="request-section-title">
                                {searchQuery ? 'Search Results' : (isService ? 'All Clients' : 'All Contacts')}
                            </h3>
                            <div className="request-contacts-list">
                                {filteredContacts.length > 0 ? (
                                    filteredContacts.map((contact) => (
                                        <Pressable
                                            key={contact.id}
                                            className="request-contact-item"
                                            onClick={() => handleSelectContact(contact)}
                                        >
                                            <div className="request-contact-avatar">
                                                {contact.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="request-contact-info">
                                                <span className="request-contact-name">{contact.name}</span>
                                                <span className="request-contact-detail">
                                                    {contact.phone || contact.email}
                                                </span>
                                            </div>
                                            <ChevronRight size={18} className="request-chevron" />
                                        </Pressable>
                                    ))
                                ) : (
                                    <div className="request-empty-state">
                                        <p>No contacts found</p>
                                        <Pressable
                                            className="request-empty-action"
                                            onClick={() => setShowManualEntry(true)}
                                        >
                                            Enter manually instead
                                        </Pressable>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
