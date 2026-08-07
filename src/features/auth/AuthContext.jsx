import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ApiError, AUTH_UNAUTHORIZED_EVENT } from '@/lib/api/client'
import {
  authMe,
  changeMyPassword,
  loginPassword,
  logout as apiLogout,
} from '@/features/auth/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshMe = useCallback(async () => {
    setLoading(true)
    try {
      const me = await authMe()
      setUser(me)
      return me
    } catch (err) {
      setUser(null)
      if (!(err instanceof ApiError) || err.status !== 401) {
        console.error(err)
      }
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshMe()
  }, [refreshMe])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleUnauthorized = () => {
      setUser(null)
      setLoading(false)
    }
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [])

  const signInWithPassword = useCallback(async (account, password) => {
    const me = await loginPassword(account, password)
    setUser(me)
    return me
  }, [])

  const signOut = useCallback(async () => {
    try {
      await apiLogout()
    } catch (err) {
      console.error(err)
    } finally {
      setUser(null)
    }
  }, [])

  const updateMyPassword = useCallback(async (currentPassword, newPassword) => {
    return changeMyPassword(currentPassword, newPassword)
  }, [])

  const permissionSet = useMemo(() => new Set(user?.permissions || []), [user?.permissions])
  const can = useCallback((permission) => {
    if (!permission || user?.role === 'admin') return true
    return permissionSet.has(permission)
  }, [permissionSet, user?.role])

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: !!user,
      isAdmin: user?.role === 'admin',
      can,
      refreshMe,
      signInWithPassword,
      signOut,
      updateMyPassword
    }),
    [user, loading, can, refreshMe, signInWithPassword, signOut, updateMyPassword]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
