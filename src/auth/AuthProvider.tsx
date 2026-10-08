import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, configured } from '../lib/supabase'
import type { Profile } from '../lib/types'

interface AuthValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
}
const AuthContext = createContext<AuthValue | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const identity = useRef<string | null>(null)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    const {
      data: { session: current },
      error: sessionError,
    } = await supabase.auth.getSession()
    if (request !== generation.current) return
    if (identity.current !== (current?.user.id ?? null)) {
      cache.clear()
      identity.current = current?.user.id ?? null
      setProfile(null)
    }
    setSession(current)
    if (sessionError) setError(sessionError.message)
    if (current) {
      const result = await supabase.from('profiles').select('*').eq('id', current.user.id).single()
      if (request !== generation.current) return
      if (result.error) {
        setProfile(null)
        setError('Unable to load your access profile. Retry or contact your developer.')
      } else {
        setProfile(result.data as Profile)
        setError(null)
        if (!result.data.active) cache.clear()
      }
    } else {
      setProfile(null)
      cache.clear()
    }
    setLoading(false)
  }, [cache])
  useEffect(() => {
    if (!configured) return
    let alive = true
    const run = () => {
      if (alive) void refresh()
    }
    run()
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      generation.current++
      setSession(next)
      if (identity.current !== (next?.user.id ?? null)) {
        identity.current = next?.user.id ?? null
        setProfile(null)
        cache.clear()
        setLoading(Boolean(next))
      }
      setTimeout(run, 0)
    })
    const timer = window.setInterval(run, 60000)
    window.addEventListener('focus', run)
    return () => {
      alive = false
      subscription.unsubscribe()
      clearInterval(timer)
      window.removeEventListener('focus', run)
    }
  }, [refresh, cache])
  const logout = async () => {
    const result = await supabase.auth.signOut()
    if (result.error) throw result.error
    cache.clear()
    setSession(null)
    setProfile(null)
  }
  return (
    <AuthContext.Provider
      value={{ session, profile, loading: configured ? loading : false, error, refresh, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}
// Kept alongside its provider so the session contract stays in one module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider missing')
  return value
}
