import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from './api/client';
import { keys } from './api/hooks';
import { App } from './App';
import { ToastProvider } from './components/Toasts';
import { I18nProvider } from './i18n';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // A refused request will be refused again; only flaky networks deserve a retry.
      retry: (count, error) => count < 2 && error instanceof ApiError && error.status === 0,
    },
  },
});

// A session that ended elsewhere shows up as a 401 on any call: back to the sign-in page.
const signedOut = (error: unknown) => {
  if (error instanceof ApiError && error.status === 401) queryClient.setQueryData(keys.me, null);
};
queryClient.getQueryCache().config.onError = signedOut;
queryClient.getMutationCache().config.onError = signedOut;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
