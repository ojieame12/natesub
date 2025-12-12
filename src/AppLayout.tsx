import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Home, Users, Plus, Activity, User } from 'lucide-react'
import { prefetchRoute } from './utils/prefetch'
import './AppLayout.css'

const NAV_ITEMS_LEFT = [
    { icon: Home, path: '/dashboard', label: 'Home' },
    { icon: Users, path: '/subscribers', label: 'Subscribers' },
]

const NAV_ITEMS_RIGHT = [
    { icon: Activity, path: '/activity', label: 'Activity' },
    { icon: User, path: '/profile', label: 'Profile' },
]

function BottomNav() {
    const navigate = useNavigate()
    const location = useLocation()
    const [pressedTab, setPressedTab] = useState<string | null>(null)
    const [centerPressed, setCenterPressed] = useState(false)

    const renderTabItem = (item: { icon: typeof Home; path: string; label: string }) => {
        const isActive = location.pathname === item.path ||
            (item.path === '/dashboard' && location.pathname === '/')
        const Icon = item.icon

        return (
            <button
                key={item.path}
                className={`tab-item ${isActive ? 'active' : ''} ${pressedTab === item.path ? 'pressed' : ''}`}
                onClick={() => navigate(item.path)}
                onMouseDown={() => setPressedTab(item.path)}
                onMouseUp={() => setPressedTab(null)}
                onMouseLeave={() => setPressedTab(null)}
                onTouchStart={() => {
                    setPressedTab(item.path)
                    prefetchRoute(item.path)
                }}
                onTouchEnd={() => setPressedTab(null)}
                onMouseEnter={() => prefetchRoute(item.path)}
            >
                <Icon size={24} className="tab-icon" />
            </button>
        )
    }

    return (
        <nav className="tab-bar">
            <div className="tab-bar-inner">
                {NAV_ITEMS_LEFT.map(renderTabItem)}
                <button
                    className={`tab-center-btn ${centerPressed ? 'pressed' : ''}`}
                    onClick={() => navigate('/new-request')}
                    onMouseDown={() => setCenterPressed(true)}
                    onMouseUp={() => setCenterPressed(false)}
                    onMouseLeave={() => setCenterPressed(false)}
                    onTouchStart={() => {
                        setCenterPressed(true)
                        prefetchRoute('/request/new')
                    }}
                    onTouchEnd={() => setCenterPressed(false)}
                    onMouseEnter={() => prefetchRoute('/request/new')}
                >
                    <Plus size={24} className="tab-icon" />
                </button>
                {NAV_ITEMS_RIGHT.map(renderTabItem)}
            </div>
        </nav>
    )
}

interface AppLayoutProps {
    children: React.ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
    return (
        <div className="app-layout">
            <div className="app-content">
                {children}
            </div>
            <BottomNav />
        </div>
    )
}
