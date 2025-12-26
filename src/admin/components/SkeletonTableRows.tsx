import { Skeleton } from '../../components/Skeleton'

interface Props {
  columns: number
  rows?: number
}

export function SkeletonTableRows({ columns, rows = 5 }: Props) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} style={{ animationDelay: `${i * 50}ms` }}>
          {Array.from({ length: columns }).map((_, j) => (
            <td key={j}>
              <Skeleton width={j === 0 ? '80%' : '60%'} height={16} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
