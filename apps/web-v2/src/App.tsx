import { Navigate, Route, Routes } from 'react-router';
import { useMe } from './api/hooks';
import { Button, ErrorNote, Spinner } from './components/ui';
import { useI18n } from './i18n';
import { AppShell } from './layout/AppShell';
import { AdminPage } from './pages/AdminPage';
import { LibraryPage } from './pages/LibraryPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { MixesPage } from './pages/MixesPage';
import { ScenePage } from './pages/ScenePage';
import { ScenesPage } from './pages/ScenesPage';
import { SettingsPage } from './pages/SettingsPage';
import { SoundsPage } from './pages/SoundsPage';

/**
 * Signed out: the sign-in page. Signed in: the board, whatever the address.
 * A password reset link opens its own page in both cases.
 */
export function App() {
  const { t, errorText } = useI18n();
  const me = useMe();

  if (me.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  if (me.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <ErrorNote>{errorText(me.error)}</ErrorNote>
        <Button onClick={() => void me.refetch()}>{t('common.retry')}</Button>
      </div>
    );
  }
  if (!me.data) {
    return (
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  const user = me.data;
  return (
    <Routes>
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<AppShell me={user} />}>
        {user.role === 'admin' && <Route path="/admin" element={<AdminPage me={user} />} />}
        <Route path="/scenes" element={<ScenesPage me={user} />} />
        <Route path="/scenes/:id" element={<ScenePage me={user} />} />
        <Route path="/mixes" element={<MixesPage me={user} />} />
        <Route path="/sounds" element={<SoundsPage me={user} />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/profile" element={<ProfilePage me={user} />} />
        <Route path="/settings" element={<SettingsPage me={user} />} />
        <Route path="*" element={<Navigate to="/scenes" replace />} />
      </Route>
    </Routes>
  );
}
