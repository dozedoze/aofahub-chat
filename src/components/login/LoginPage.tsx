import { useState, type FormEvent } from 'react'
import { login } from '../../services/auth.js'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import styles from './LoginPage.module.css'

export const LoginPage = () => {
  const t = useTranslate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await login(username.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'))
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
          />
        </label>
        <label>
          {t('password')}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className={styles.err}>{error}</p> : null}
        <Button type="submit" size="m" disabled={busy || !username.trim() || !password}>
          {busy ? t('loggingIn') : t('login')}
        </Button>
      </form>
    </div>
  )
}
