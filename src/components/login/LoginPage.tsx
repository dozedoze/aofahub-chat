import { useEffect, useState, type FormEvent } from 'react'
import { login, LoginError } from '../../services/auth.js'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import styles from './LoginPage.module.css'

const MAX_ATTEMPTS = 5
/** 与网关 GATE.loginLockMs 对齐；服务端 429 会覆盖成 retry-after。 */
const LOCK_SECONDS = 15 * 60

export const LoginPage = () => {
  const t = useTranslate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fails, setFails] = useState(0)
  const [lockUntil, setLockUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!lockUntil) {
      return
    }
    const timer = window.setInterval(() => {
      const next = Date.now()
      setNow(next)
      if (next >= lockUntil) {
        window.clearInterval(timer)
        setFails(0)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [lockUntil])

  const locked = lockUntil > now
  const remainSec = locked ? Math.max(1, Math.ceil((lockUntil - now) / 1000)) : 0
  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - fails)

  const lockFor = (seconds: number) => {
    setLockUntil(Date.now() + Math.max(1, seconds) * 1000)
    setNow(Date.now())
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || locked) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await login(username.trim(), password)
    } catch (err) {
      const retryAfter = err instanceof LoginError ? err.retryAfter : undefined
      if (err instanceof LoginError && err.status === 429) {
        setFails(MAX_ATTEMPTS)
        lockFor(retryAfter ?? LOCK_SECONDS)
        setError('')
      } else {
        const next = fails + 1
        setFails(next)
        if (next >= MAX_ATTEMPTS) {
          lockFor(retryAfter ?? LOCK_SECONDS)
          setError('')
        } else {
          const failedAuth = err instanceof LoginError && err.status === 401
          setError(failedAuth || !(err instanceof Error) ? t('loginFailed') : err.message)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={submit}>
        <h1>{t('appName')}</h1>
        <p className={styles.sub}>{t('loginHint')}</p>
        <label>
          {t('username')}
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            disabled={locked}
          />
        </label>
        <label>
          {t('password')}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={locked}
          />
        </label>
        {locked ? (
          <p className={styles.err}>{t('loginLocked', { seconds: remainSec })}</p>
        ) : (
          <>
            {error ? <p className={styles.err}>{error}</p> : null}
            {fails > 0 ? (
              <p className={styles.hint}>{t('loginAttemptsLeft', { count: attemptsLeft })}</p>
            ) : null}
          </>
        )}
        <Button type="submit" size="m" disabled={busy || locked || !username.trim() || !password}>
          {busy ? t('loggingIn') : t('login')}
        </Button>
      </form>
    </div>
  )
}
