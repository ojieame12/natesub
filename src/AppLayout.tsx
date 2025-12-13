import { useState } from 'react'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { Home, Users, Plus, Activity, User } from 'lucide-react'
import { prefetchRoute } from './utils/prefetch'
import { useHaptics } from './hooks'
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

    const { selection, impact } = useHaptics()

    const renderTabItem = (item: { icon: typeof Home; path: string; label: string }) => {
        const isActive = location.pathname === item.path ||
            (item.path === '/dashboard' && location.pathname === '/')
        const Icon = item.icon

        const handlePress = () => {
            setPressedTab(item.path)
            selection() // Light tick on press
        }

        return (
            <button
                key={item.path}
                className={`tab-item ${isActive ? 'active' : ''} ${pressedTab === item.path ? 'pressed' : ''}`}
                onClick={() => {
                    navigate(item.path)
                    setPressedTab(null)
                }}
                onMouseDown={handlePress}
                onMouseUp={() => setPressedTab(null)}
                onMouseLeave={() => setPressedTab(null)}
                onTouchStart={() => {
                    handlePress()
                    prefetchRoute(item.path)
                }}
                onTouchEnd={() => setPressedTab(null)}
                onMouseEnter={() => prefetchRoute(item.path)}
            >
                <Icon size={24} className={`tab-icon ${isActive ? 'active-bounce' : ''}`} />
            </button>
        )
    }

    return (
        <nav className="tab-bar">
            <div className="tab-bar-inner">
                {NAV_ITEMS_LEFT.map(renderTabItem)}
                <button
                    className={`tab-center-btn ${centerPressed ? 'pressed' : ''}`}
                    onClick={() => {
                        navigate('/new-request')
                        setCenterPressed(false)
                    }}
                    onMouseDown={() => {
                        setCenterPressed(true)
                        impact('medium') // Heavier impact for main action
                    }}
                    onMouseUp={() => setCenterPressed(false)}
                    onMouseLeave={() => setCenterPressed(false)}
                    onTouchStart={() => {
                        setCenterPressed(true)
                        impact('medium')
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
    children?: React.ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
    const { pathname } = useLocation()

    // Routes where we should show the bottom navigation
    const showNav = ['/dashboard', '/activity', '/profile', '/subscribers', '/requests', '/updates', '/settings'].some(path =>
        pathname === path || (pathname !== '/' && pathname.startsWith(path))
    )

    return (
        <div className="app-layout">
            <main className="app-content">
                {children || <Outlet />}
            </main>

            {showNav && <BottomNav />}
        </div>
    )
}
