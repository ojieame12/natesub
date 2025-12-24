import { Suspense, useMemo, useState } from 'react'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { Home, Users, Plus, Activity, User } from 'lucide-react'
import { prefetchAll } from './utils/prefetch'
import { useAuthState, useHaptics } from './hooks'
import { ContentSkeleton } from './components'
import './AppLayout.css'

const NAV_ITEMS_RIGHT = [
    { icon: Activity, path: '/activity', label: 'Activity' },
    { icon: User, path: '/profile', label: 'Profile' },
]

function BottomNav() {
    const navigate = useNavigate()
    const location = useLocation()
    const [pressedTab, setPressedTab] = useState<string | null>(null)
    const [centerPressed, setCenterPressed] = useState(false)

    const { user } = useAuthState()
    const isService = user?.profile?.purpose === 'service'
    const navItemsLeft = useMemo(() => [
        { icon: Home, path: '/dashboard', label: 'Home' },
        { icon: Users, path: '/subscribers', label: isService ? 'Clients' : 'Subscribers' },
    ], [isService])

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
                aria-label={item.label}
                title={item.label}
                onClick={() => {
                    navigate(item.path)
                    setPressedTab(null)
                }}
                onMouseDown={handlePress}
                onMouseUp={() => setPressedTab(null)}
                onMouseLeave={() => setPressedTab(null)}
                onTouchStart={() => {
                    handlePress()
                    prefetchAll(item.path)
                }}
                onTouchEnd={() => setPressedTab(null)}
                onMouseEnter={() => prefetchAll(item.path)}
            >
                <Icon size={24} className={`tab-icon ${isActive ? 'active-bounce' : ''}`} />
            </button>
        )
    }

    return (
        <nav className="tab-bar">
            <div className="tab-bar-inner">
                {navItemsLeft.map(renderTabItem)}
                <button
                    className={`tab-center-btn ${centerPressed ? 'pressed' : ''}`}
                    aria-label="New request"
                    title="New request"
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
                        prefetchAll('/new-request')
                    }}
                    onTouchEnd={() => setCenterPressed(false)}
                    onMouseEnter={() => prefetchAll('/new-request')}
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
                {children || (
                    // Suspense boundary inside layout keeps BottomNav visible during lazy loads
                    <Suspense fallback={<ContentSkeleton />}>
                        <Outlet />
                    </Suspense>
                )}
            </main>

            {showNav && <BottomNav />}
        </div>
    )
}
