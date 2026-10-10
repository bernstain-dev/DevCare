import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './auth/AuthProvider'
import { App } from './App'
import { supabase } from './lib/supabase'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
})

export default function Portal() {
  useEffect(() => {
    supabase.auth.startAutoRefresh()
    return () => {
      supabase.auth.stopAutoRefresh()
      void queryClient.cancelQueries()
      queryClient.clear()
    }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  )
}
