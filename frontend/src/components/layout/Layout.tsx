import { Sidebar } from './Sidebar'
import { MobileHeader } from './MobileHeader'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <MobileHeader />
      <main className="flex-1 min-w-0 pt-14 md:pt-0">
        {children}
      </main>
    </div>
  )
}
