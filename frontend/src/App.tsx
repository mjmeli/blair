import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnalyticsConsent } from './components/common/AnalyticsConsent';
import { initAnalytics, trackPageView } from './analytics';
import { LoginPage } from './components/layout/LoginPage';
import { Dashboard } from './components/layout/Dashboard';
import { isAuthenticated } from './services/api';

initAnalytics();

function PageViews() {
  const location = useLocation();
  useEffect(() => { trackPageView(location.pathname); }, [location.pathname]);
  return null;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <PageViews />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <AnalyticsConsent />
    </BrowserRouter>
  );
}
