/**
 * AdminChart - Chart wrapper components for admin dashboard
 */

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

interface ChartProps {
  title: string
  loading?: boolean
}

interface LineChartData {
  label: string
  value: number
  [key: string]: string | number
}

interface BarChartData {
  label: string
  value: number
  [key: string]: string | number
}

interface PieChartData {
  name: string
  value: number
  [key: string]: string | number
}

const COLORS = ['#0a84ff', '#34c759', '#ff9f0a', '#ff453a', '#5e5ce6']

// Custom tooltip style
const tooltipStyle = {
  backgroundColor: 'var(--bg-secondary)',
  border: '1px solid var(--border-primary)',
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '12px',
}

export function AdminLineChart({
  title,
  data,
  loading = false,
  dataKey = 'value',
  xAxisKey = 'label',
  formatValue,
}: ChartProps & {
  data: LineChartData[]
  dataKey?: string
  xAxisKey?: string
  formatValue?: (value: number) => string
}) {
  if (loading) {
    return (
      <div className="admin-chart-container">
        <div className="admin-chart-title">{title}</div>
        <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>Loading...</span>
        </div>
      </div>
    )
  }

  if (!data?.length) {
    return (
      <div className="admin-chart-container">
        <div className="admin-chart-title">{title}</div>
        <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>No data available</span>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-chart-container">
      <div className="admin-chart-title">{title}</div>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
          <XAxis
            dataKey={xAxisKey}
            tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border-primary)' }}
          />
          <YAxis
            tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border-primary)' }}
            tickFormatter={formatValue}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number | string) => [formatValue ? formatValue(Number(value)) : value, 'Value']}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke="#0a84ff"
            strokeWidth={2}
            dot={{ fill: '#0a84ff', r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function AdminBarChart({
  title,
  data,
  loading = false,
  dataKey = 'value',
  xAxisKey = 'label',
  formatValue,
  color = '#0a84ff',
}: ChartProps & {
  data: BarChartData[]
  dataKey?: string
  xAxisKey?: string
  formatValue?: (value: number) => string
  color?: string
}) {
  if (loading) {
    return (
      <div className="admin-chart-container">
        <div className="admin-chart-title">{title}</div>
        <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>Loading...</span>
        </div>
      </div>
    )
  }

  if (!data?.length) {
    return (
      <div className="admin-chart-container">
        <div className="admin-chart-title">{title}</div>
        <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>No data available</span>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-chart-container">
      <div className="admin-chart-title">{title}</div>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
          <XAxis
            dataKey={xAxisKey}
            tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border-primary)' }}
          />
          <YAxis
            tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border-primary)' }}
            tickFormatter={formatValue}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number | string) => [formatValue ? formatValue(Number(value)) : value, 'Value']}
          />
          <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function AdminPieChart({
  title,
  data,
  loading = false,
  formatValue,
}: ChartProps & {
  data: PieChartData[]
  formatValue?: (value: number) => string
}) {
  if (loading) {
    return (
      <div className="admin-chart-container">
        <div className="admin-chart-title">{title}</div>
        <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>Loading...</span>
        </div>
      </div>
    )
  }

  if (!data?.length) {
    return (
      <div className="admin-chart-container">
        <div className="admin-chart-title">{title}</div>
        <div style={{ height: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>No data available</span>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-chart-container">
      <div className="admin-chart-title">{title}</div>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={2}
            dataKey="value"
            label={({ name, percent }: { name: string; percent?: number }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [formatValue ? formatValue(Number(value)) : value, 'Value']}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
