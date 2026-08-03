import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '#components/theme-provider.tsx';
import { getRouter } from '#router.tsx';

const queryClient = new QueryClient();
const router = getRouter(queryClient);

const rootElement = document.getElementById('app')!;

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
