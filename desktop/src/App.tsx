import { AppShell } from './components/AppShell';
import { ForestProvider } from './state/ForestContext';

export function App() {
  return (
    <ForestProvider>
      <AppShell />
    </ForestProvider>
  );
}
