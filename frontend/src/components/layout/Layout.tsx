import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="flex-1 min-w-0 pb-20 md:pb-0">
        {children}
      </main>
      <BottomNav />
    </div>
  )
}
