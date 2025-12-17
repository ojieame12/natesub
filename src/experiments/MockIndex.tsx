import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutDashboard, UserCircle, FileText, Receipt, ChevronRight } from 'lucide-react'
import { Pressable } from '../components'

type MockRoute = {
  title: string
  description: string
  path: string
  icon: ReactNode
}

export default function MockIndex() {
  const navigate = useNavigate()

  const routes = useMemo<MockRoute[]>(
    () => [
      {
        title: 'Dashboard',
        description: 'Creator overview, balances, activity feed.',
        path: '/mocks/dashboard',
        icon: <LayoutDashboard size={18} />,
      },
      {
        title: 'Profile',
        description: 'Public-facing profile preview card.',
        path: '/mocks/profile',
        icon: <UserCircle size={18} />,
      },
      {
        title: 'Invoices',
        description: 'Sent requests / invoices list & details.',
        path: '/mocks/invoices',
        icon: <FileText size={18} />,
      },
      {
        title: 'Payroll',
        description: 'Payroll history, payouts, verification.',
        path: '/mocks/payroll',
        icon: <Receipt size={18} />,
      },
    ],
    []
  )

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '24px 16px',
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <img src="/logo.svg" alt="NatePay" style={{ height: 26, width: 'auto' }} />
        </div>

        <div
          style={{
            marginBottom: 14,
            textAlign: 'center',
            color: 'var(--neutral-900)',
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>
            Screenshot Pages
          </div>
          <div style={{ marginTop: 6, fontSize: 14, color: 'var(--neutral-600)' }}>
            Static, safe mock routes for marketing screenshots.
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {routes.map((route) => (
            <Pressable
              key={route.path}
              className="pressable pressable-card"
              onClick={() => navigate(route.path)}
              style={{
                borderRadius: 18,
                padding: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--neutral-50)',
                    color: 'var(--neutral-900)',
                    flex: '0 0 auto',
                  }}
                >
                  {route.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--neutral-900)' }}>
                    {route.title}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--neutral-600)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {route.description}
                  </div>
                </div>
              </div>

              <div style={{ color: 'var(--neutral-500)', flex: '0 0 auto' }}>
                <ChevronRight size={18} />
              </div>
            </Pressable>
          ))}
        </div>

        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--neutral-500)', textAlign: 'center' }}>
          If these routes 404 on a deployed build, set <code>VITE_ENABLE_MOCK_ROUTES=true</code> and redeploy.
        </div>
      </div>
    </div>
  )
}
